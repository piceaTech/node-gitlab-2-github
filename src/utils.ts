import settings from '../settings';
import * as mime from 'mime-types';
import * as path from 'path';
import * as crypto from 'crypto';
import S3 from 'aws-sdk/clients/s3';
import { BlobServiceClient, StorageSharedKeyCredential } from '@azure/storage-blob';
import { GitlabHelper } from './gitlabHelper';

export const sleep = (milliseconds: number) => {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
};

// Creates new attachments and replaces old links
export const migrateAttachments = async (
  body: string,
  githubRepoId: number | undefined,
  gitlabHelper: GitlabHelper
) => {
  const regexp = /(!?)\[([^\]]+)\]\((\/uploads[^)]+)\)/g;

  // Maps link offset to a new name in S3
  const offsetToAttachment: {
    [key: number]: string;
  } = {};

  // Find all local links
  const matches = body.matchAll(regexp);

  for (const match of matches) {
    const prefix = match[1] || '';
    const name = match[2];
    const url = match[3];

    const s3 = settings.s3;
    const azure = settings.azure;
    if (s3 && s3.bucket) {
      const basename = path.basename(url);
      const mimeType = mime.lookup(basename);
      const attachmentBuffer = await gitlabHelper.getAttachment(url);
      if (!attachmentBuffer) {
        continue;
      }

      // // Generate file name for S3 bucket from URL
      const hash = crypto.createHash('sha256');
      hash.update(url);
      const newFileName = hash.digest('hex') + '/' + basename;
      const relativePath = githubRepoId
        ? `${githubRepoId}/${newFileName}`
        : newFileName;
      // Doesn't seem like it is easy to upload an issue to github, so upload to S3
      //https://stackoverflow.com/questions/41581151/how-to-upload-an-image-to-use-in-issue-comments-via-github-api

      // Attempt to fix issue #140
      //const s3url = `https://${s3.bucket}.s3.amazonaws.com/${relativePath}`;
      let hostname = `${s3.bucket}.s3.amazonaws.com`;
      if (s3.region) {
        hostname = `s3.${s3.region}.amazonaws.com/${s3.bucket}`;
      }
      const s3url = `https://${hostname}/${relativePath}`;

      const s3bucket = new S3();
      s3bucket.createBucket(() => {
        const params: S3.PutObjectRequest = {
          Key: relativePath,
          Body: attachmentBuffer,
          ContentType: mimeType === false ? undefined : mimeType,
          Bucket: s3.bucket,
        };

        s3bucket.upload(params, function (err, data) {
          console.log(`\tUploading ${basename} to ${s3url}... `);
          if (err) {
            console.log('ERROR: ', err);
          } else {
            console.log(`\t...Done uploading`);
          }
        });
      });

      // Add the new URL to the map
      offsetToAttachment[
        match.index as number
      ] = `${prefix}[${name}](${s3url})`;
    } else if (azure && azure.container) {
      const basename = path.basename(url);
      const mimeType = mime.lookup(basename);
      const attachmentBuffer = await gitlabHelper.getAttachment(url);
      if (!attachmentBuffer) {
        continue;
      }

      // Generate file name for Azure Blob from URL
      const hash = crypto.createHash('sha256');
      hash.update(url);
      const newFileName = hash.digest('hex') + '/' + basename;
      const relativePath = githubRepoId ? `${githubRepoId}/${newFileName}` : newFileName;

      // Build BlobServiceClient
      let blobServiceClient: BlobServiceClient;
      if (azure.connectionString) {
        blobServiceClient = BlobServiceClient.fromConnectionString(azure.connectionString);
      } else if (azure.accountName && azure.accountKey) {
        const endpoint = (azure.endpoint
          ? azure.endpoint
          : `https://${azure.accountName}.blob.core.windows.net`);
        const cred = new StorageSharedKeyCredential(azure.accountName, azure.accountKey);
        blobServiceClient = new BlobServiceClient(endpoint, cred);
      } else {
        console.log('Azure storage not configured (missing credentials). Skipping upload.');
        continue;
      }

      const containerClient = blobServiceClient.getContainerClient(azure.container);
      const blobClient = containerClient.getBlockBlobClient(relativePath);
      const contentType = mimeType === false ? undefined : (mimeType as string);
      const targetUrlBase = (azure.endpoint
        ? `${azure.endpoint}`
        : (azure.accountName ? `https://${azure.accountName}.blob.core.windows.net` : ''));
      const blobUrl = `${targetUrlBase}/${azure.container}/${relativePath}`;

      console.log(`\tUploading ${basename} to ${blobUrl}... `);
      try {
        await blobClient.uploadData(attachmentBuffer, {
          blobHTTPHeaders: contentType ? { blobContentType: contentType } : undefined,
        });
        console.log(`\t...Done uploading`);
      } catch (err) {
        console.log('ERROR: ', err);
      }

      // Add the new URL to the map
      offsetToAttachment[match.index as number] = `${prefix}[${name}](${blobUrl})`;

    } else {
      // Not using S3: default to old URL, adding absolute path
      const host = gitlabHelper.host.endsWith('/')
        ? gitlabHelper.host
        : gitlabHelper.host + '/';
      const attachmentUrl = host + gitlabHelper.projectPath + url;
      offsetToAttachment[
        match.index as number
      ] = `${prefix}[${name}](${attachmentUrl})`;
    }
  }

  return body.replace(
    regexp,
    ({}, {}, {}, {}, offset, {}) => offsetToAttachment[offset]
  );
};

export const organizationUsersString = (users: string[], prefix: string): string => {
  let organizationUsers = [];
  for (let assignee of users) {
    let githubUser = settings.usermap[assignee as string];
    if (githubUser) {
      githubUser = '@' + githubUser;
    } else {
      githubUser = assignee as string;
    }
    organizationUsers.push(githubUser);
  }

  if (organizationUsers.length > 0) {
    return `\n\n**${prefix}:** ` + organizationUsers.join(', ');
  }

  return '';
}
