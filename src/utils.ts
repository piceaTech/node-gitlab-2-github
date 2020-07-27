import settings from '../settings';
import { S3Settings } from './settings';
import * as mime from 'mime-types';
import * as path from 'path';
import * as crypto from 'crypto';
import S3 from 'aws-sdk/clients/s3';
import GitlabHelper from './gitlabHelper';

export const sleep = (milliseconds: number) => {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
};

/**
 * Generate regular expression which finds userid and cross-project issue references
 * from usermap and projectmap
 */
export const generateUserProjectRegex = () => {
  let reString = '';
  if (settings.usermap !== null && Object.keys(settings.usermap).length > 0) {
    reString = '@' + Object.keys(settings.usermap).join('|@');
  }
  if (
    settings.projectmap !== null &&
    Object.keys(settings.projectmap).length > 0
  ) {
    if (reString.length > 0) {
      reString += '|';
    }
    reString += Object.keys(settings.projectmap).join('#|') + '#';
  }

  return new RegExp(reString, 'g');
};

// Creates new attachments and replaces old links
export const migrateAttachments = async (body: string, githubRepoId: number | undefined, s3: S3Settings, gitlabHelper: GitlabHelper) => {
  const regexp = /!\[([^\]]+)\]\((\/uploads[^)]+)\)/g;

  // Maps link offset to a new name in S3
  const offsetToAttachment: {
    [key: number]: string;
  } = {};

  // Find all local links
  const matches = body.matchAll(regexp);

  for (const match of matches) {
    const name = match[1];
    const url = match[2];

    const basename = path.basename(url);
    const extension = path.extname(url);
    const mimeType = mime.lookup(basename);
    const attachmentBuffer = await gitlabHelper.getAttachment(url);

    // Generate new random file name for S3 bucket
    const id = crypto.randomBytes(16).toString('hex');
    const newFileName = id + extension;
    const relativePath = githubRepoId ? `${githubRepoId}/${newFileName}` : newFileName;

    // Doesn't seem like it is easy to upload an issue to github, so upload to S3
    //https://stackoverflow.com/questions/41581151/how-to-upload-an-image-to-use-in-issue-comments-via-github-api

    const s3url = `https://${s3.bucket}.s3.amazonaws.com/${relativePath}`;

    const s3bucket = new S3();
    s3bucket.createBucket(() => {
      const params: S3.PutObjectRequest = {
        Key: relativePath,
        Body: attachmentBuffer,
        ContentType: mimeType === false ? null : mimeType,
        Bucket: s3.bucket,
      };

      s3bucket.upload(params, function (err, data) {
        console.log(`\tUploaded ${basename} to ${s3url}`);
        if (err) {
          console.log('ERROR MSG: ', err);
        }
      });
    });

    // Add the new URL to the map
    offsetToAttachment[match.index] = `![${name}](${s3url})`;

  }

  return body.replace(regexp, ({},{},{},offset,{}) => offsetToAttachment[offset]);
};
