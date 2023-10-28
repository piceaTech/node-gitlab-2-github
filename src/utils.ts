import { GithubAttachmentSettings, S3Settings } from './settings';
import * as mime from 'mime-types';
import * as path from 'path';
import * as crypto from 'crypto';
import S3 from 'aws-sdk/clients/s3';
import { GitlabHelper } from './gitlabHelper';
import { GithubSettings } from './settings';
import settings from '../settings';
import { Octokit as GitHubApi, RestEndpointMethodTypes } from '@octokit/rest';

export const sleep = (milliseconds: number) => {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
};

// Creates new attachments and replaces old links
export const migrateAttachments = async (
  body: string,
  githubApi: GitHubApi,
  githubRepoId: number | undefined,
  s3: S3Settings | undefined,
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

      const s3url = `https://${s3.bucket}.s3.amazonaws.com/${relativePath}`;

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
    }
    // Using Github attachmentRepo
    else if (settings.githubAttachmentSettings?.repo){
      const basename = path.basename(url);
      const mimeType = mime.lookup(basename);
      const attachmentBuffer = await gitlabHelper.getAttachment(url);
      if (!attachmentBuffer) {
        continue;
      }
      const b64Data = attachmentBuffer.toString('base64');

      // // Generate file name for S3 bucket from URL
      const hash = crypto.createHash('sha256');
      const uuid_n = crypto.randomUUID();
      hash.update(url);
      const newFileName = hash.digest('hex') + `-${uuid_n}` + '/' + basename;
      const relativePath = githubRepoId
        ? `${githubRepoId}/${newFileName}`
        : newFileName;
      // Doesn't seem like it is easy to upload an issue to github, so upload to S3
      //https://stackoverflow.com/questions/41581151/how-to-upload-an-image-to-use-in-issue-comments-via-github-api
      let owner = settings.github.owner;
      const final_url = `https://github.com/${owner}/${settings.githubAttachmentSettings.repo}/blob/main/${relativePath}`;
        console.log(`\tUploading ${basename} to ${final_url}... `);
        githubApi.request(`PUT /repos/${owner}/${settings.githubAttachmentSettings.repo}/contents/${relativePath}`, {
            owner: owner,
            repo: settings.githubAttachmentSettings.repo,
            path: `${relativePath}`,
            message: `${basename} commit`,
            ref: 'heads/main',
            committer: {
              name: settings.github.token_owner,
              email: settings.githubAttachmentSettings.email
            },
            content: b64Data,
            headers: {
              'X-GitHub-Api-Version': '2022-11-28'
            }
          }).catch(err => {
            console.log(`Error while transfering ${relativePath}`);
          })
        // Add the new URL to the map
      offsetToAttachment[
        match.index as number
      ] = `[📎${name}](${final_url})`;
    }
    else {
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
