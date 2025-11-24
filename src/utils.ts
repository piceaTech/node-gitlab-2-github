import { S3Settings } from './settings';
import settings from '../settings';
import * as mime from 'mime-types';
import * as path from 'path';
import * as crypto from 'crypto';
import * as fs from 'fs';
import S3 from 'aws-sdk/clients/s3';
import { GitlabHelper } from './gitlabHelper';

export const sleep = (milliseconds: number) => {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
};

export const readProjectsFromCsv = (
  filePath: string,
  idColumn: number = 0,
  gitlabPathColumn: number = 1,
  githubPathColumn: number = 2
): Map<number, [string, string]> => {
  try {
    if (!fs.existsSync(filePath)) {
      throw new Error(`CSV file not found: ${filePath}`);
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split(/\r?\n/);
    const projectMap = new Map<number, [string, string]>();
    let headerSkipped = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      if (!line || line.startsWith('#')) {
        continue;
      }

      const values = line.split(',').map(v => v.trim());
      const maxColumn = Math.max(idColumn, gitlabPathColumn, githubPathColumn);
      
      if (maxColumn >= values.length) {
        console.warn(`Warning: Line ${i + 1} has only ${values.length} column(s), skipping (need column ${maxColumn})`);
        if (!headerSkipped) {
          headerSkipped = true;
        }
        continue;
      }

      const idStr = values[idColumn];
      const gitlabPath = values[gitlabPathColumn];
      const githubPath = values[githubPathColumn];

      if (!headerSkipped) {
        const num = parseInt(idStr, 10);
        if (isNaN(num) || idStr.toLowerCase().includes('id') || idStr.toLowerCase().includes('project')) {
          console.log(`Skipping CSV header row: "${line}"`);
          headerSkipped = true;
          continue;
        }
        headerSkipped = true;
      }

      if (!idStr || !gitlabPath || !githubPath) {
        console.warn(`Warning: Line ${i + 1} has empty values, skipping`);
        continue;
      }

      const projectId = parseInt(idStr, 10);
      if (isNaN(projectId)) {
        console.warn(`Warning: Line ${i + 1}: Invalid project ID "${idStr}", skipping`);
        continue;
      }

      projectMap.set(projectId, [gitlabPath, githubPath]);
    }

    if (projectMap.size === 0) {
          throw new Error(`No valid project mappings found in CSV file: ${filePath}`);
        }
    
        console.log(`✓ Loaded ${projectMap.size} project mappings from CSV`);
        return projectMap;
      } catch (err) {
        console.error(`Error reading project mapping CSV file: ${err.message}`);
        throw err;
  }
};

// Creates new attachments and replaces old links
export const migrateAttachments = async (
  body: string,
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
