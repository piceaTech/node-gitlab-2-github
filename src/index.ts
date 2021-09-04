import GithubHelper from './githubHelper';
import GitlabHelper from './gitlabHelper';
import settings from '../settings';

import {Octokit as GitHubApi} from '@octokit/rest';
import {Gitlab} from '@gitbeaker/node'

import * as fs from 'fs';

import AWS from 'aws-sdk';


const issueCounters = {
  nrOfPlaceholderIssues: 0,
  nrOfReplacementIssues: 0,
  nrOfFailedIssues: 0,
};

if (settings.s3) {
  AWS.config.accessKeyId = settings.s3.accessKeyId;
  AWS.config.secretAccessKey = settings.s3.secretAccessKey;
}

//let settings = null;
try {
  //settings = require('../settings.js');
} catch (e) {
  if (e.code === 'MODULE_NOT_FOUND') {
    console.log('\n\nPlease copy the sample_settings.js to settings.js.');
  } else {
    console.log(e);
  }

  process.exit(1);
}

// Ensure that the GitLab token has been set in settings.js
if (
  !settings.gitlab.token ||
  settings.gitlab.token === '{{gitlab private token}}'
) {
  console.log(
    '\n\nYou have to enter your GitLab private token in the settings.js file.'
  );
  process.exit(1);
}

// Create a GitLab API object
const gitlabApi = new Gitlab({
  host: settings.gitlab.url ? settings.gitlab.url : 'http://gitlab.com',
  token: settings.gitlab.token,
});

// Create a GitHub API object
const githubApi = new GitHubApi({
  debug: false,
  baseUrl: settings.github.baseUrl
    ? settings.github.baseUrl
    : 'https://api.github.com',
  timeout: settings.timeout,
  headers: {
    'user-agent': 'node-gitlab-2-github', // GitHub is happy with a unique user agent
    accept: 'application/vnd.github.v3+json',
  },
  auth: 'token ' + settings.github.token,
});

const gitlabHelper = new GitlabHelper(gitlabApi, settings.gitlab);
const githubHelper = new GithubHelper(githubApi,
                                      settings.github,
                                      gitlabHelper,
                                      settings.useIssuesForAllMergeRequests);

// If no project id is given in settings.js, just return
// all of the projects that this user is associated with.
if (!settings.gitlab.projectId) {
  gitlabHelper.listProjects();
} else {
  // user has chosen a project
  migrate();
}

// ----------------------------------------------------------------------------

/*
 * TODO description
 */
function createPlaceholderIssue(expectedIdx: number) {
  return {
    iid: expectedIdx,
    title: `[PLACEHOLDER ISSUE] - for issue #${expectedIdx}`,
    description:
      'This is to ensure the issue numbers in GitLab and GitHub are the same',
    state: 'closed',
    isPlaceholder: true,
  };
}

// ----------------------------------------------------------------------------

/*
 * TODO description
 */
function createReplacementIssue(id, title, state) {
  const originalGitlabIssueLink = 'TODO'; // TODO
  const description = `The original issue\n\n\tId: ${id}\n\tTitle: ${title}\n\ncould not be created.\nThis is a dummy issue, replacing the original one. It contains everything but the original issue description. In case the gitlab repository is still existing, visit the following link to show the original issue:\n\n${originalGitlabIssueLink}`;

  return {
    iid: id,
    title: `${title} [REPLACEMENT ISSUE]`,
    description,
    state,
  };
}

// ----------------------------------------------------------------------------

/**
 * Performs all of the migration tasks to move a GitLab repo to GitHub
 */
async function migrate() {
  //
  // Sequentially transfer repo things
  //

  try {

    await githubHelper.registerRepoId();

    // transfer GitLab milestones to GitHub
    if (settings.transfer.milestones) {
      await transferMilestones();
    }

    // transfer GitLab labels to GitHub
    if (settings.transfer.labels) {
      await transferLabels(true, settings.conversion.useLowerCaseLabels);
    }

    // Transfer issues with their comments; do this before transferring the merge requests
    if (settings.transfer.issues) {
      await transferIssues();
    }
    if (settings.transfer.mergeRequests) {
      if (settings.mergeRequests.log) {
        // log merge requests
        await logMergeRequests(settings.mergeRequests.logFile);
      } else {
        await transferMergeRequests();
      }
    }
  } catch (err) {
    console.error('Error during transfer:');
    console.error(err);
  }

  console.log('\n\nTransfer complete!\n\n');
}

// ----------------------------------------------------------------------------

/**
 * Transfer any milestones that exist in GitLab that do not exist in GitHub.
 */
async function transferMilestones() {
  inform('Transferring Milestones');

  // Get a list of all milestones associated with this project
  let milestones = await gitlabApi.ProjectMilestones.all(
    settings.gitlab.projectId
  ) as any[];

  if(settings.transfer.transferOnlyOpen) {
      // filter active milestones
    console.log('Transferring only open milestones');
    milestones = milestones.filter(milestone => milestone.state === "active")
  }

   if (settings.transfer.createdAfter) {
        console.log('Transferring milestones created after ' + settings.transfer.createdAfter);
        milestones = milestones.filter(milestone => Date.parse(milestone.created_at) > Date.parse(settings.transfer.createdAfter));
    }

   if (settings.transfer.updatedAfter) {
        console.log('Transferring milestones updated after ' + settings.transfer.updatedAfter);
        milestones = milestones.filter(milestone => Date.parse(milestone.updated_at) > Date.parse(settings.transfer.updatedAfter));
    }

  // sort milestones in ascending order of when they were created (by id)
  milestones = milestones.sort((a, b) => a.id - b.id);

  // get a list of the current milestones in the new GitHub repo (likely to be empty)
  const githubMilestones = await githubHelper.getAllGithubMilestones();

  // if a GitLab milestone does not exist in GitHub repo, create it.
  for (let milestone of milestones) {
    if (!githubMilestones.find(m => m.title === milestone.title)) {
      console.log('Creating: ' + milestone.title);
      try {
        // process asynchronous code in sequence
        await githubHelper.createMilestone(milestone);
      } catch (err) {
        console.error('Could not create milestone', milestone.title);
        console.error(err);
      }
    } else {
      console.log('Already exists: ' + milestone.title);
    }
  }
}

// ----------------------------------------------------------------------------

/**
 * Transfer any labels that exist in GitLab that do not exist in GitHub.
 */
async function transferLabels(attachmentLabel = true, useLowerCase = true) {
  inform('Transferring Labels');

  // Get a list of all labels associated with this project
  let labels = await gitlabApi.Labels.all(settings.gitlab.projectId);

  // get a list of the current label names in the new GitHub repo (likely to be just the defaults)
  let githubLabels = await githubHelper.getAllGithubLabelNames();

  // create a hasAttachment label for manual attachment migration
  if (attachmentLabel) {
    const hasAttachmentLabel = { name: 'has attachment', color: '#fbca04' };
    labels.push(hasAttachmentLabel);
  }

  // create gitlabMergeRequest label for non-migratable merge requests
  const gitlabMergeRequestLabel = {
    name: 'gitlab merge request',
    color: '#b36b00',
  };
  labels.push(gitlabMergeRequestLabel);

  // if a GitLab label does not exist in GitHub repo, create it.
  for (let label of labels) {
    // GitHub prefers lowercase label names
    if (useLowerCase) {
      label.name = label.name.toLowerCase();
    }

    if (!githubLabels.find(l => l === label.name)) {
      console.log('Creating: ' + label.name);
      try {
        // process asynchronous code in sequence
        await githubHelper.createLabel(label).catch(x => {});
      } catch (err) {
        console.error('Could not create label', label.name);
        console.error(err);
      }
    } else {
      console.log('Already exists: ' + label.name);
    }
  }
}

// ----------------------------------------------------------------------------

/**
 * Transfer any issues and their comments that exist in GitLab that do not exist in GitHub.
 */
async function transferIssues() {
  inform('Transferring Issues');

  await gitlabHelper. registerProjectPath(settings.gitlab.projectId);

  // Because each
  let milestoneData = await githubHelper.getAllGithubMilestones();

  // get a list of all GitLab issues associated with this project
  // TODO return all issues via pagination
  let issues = await gitlabApi.Issues.all({
    projectId: settings.gitlab.projectId,
    labels: settings.filterByLabel,
  }) as any[];

  // filter issues to only get those in state 'opened'
   if (settings.transfer.transferOnlyOpen) {
        console.log('Transferring only open issues');
        issues = issues.filter(issue => issue.state === 'opened');
    }

   if (settings.transfer.createdAfter) {
        console.log('Transferring issues created after ' + settings.transfer.createdAfter);
        issues = issues.filter(issue => Date.parse(issue.created_at) > Date.parse(settings.transfer.createdAfter));
    }

   if (settings.transfer.updatedAfter) {
        console.log('Transferring issues updated after ' + settings.transfer.updatedAfter);
        issues = issues.filter(issue => Date.parse(issue.updated_at) > Date.parse(settings.transfer.updatedAfter));
    }

  // sort issues in ascending order of their issue number (by iid)
  issues = issues.sort((a, b) => a.iid - b.iid);

  // get a list of the current issues in the new GitHub repo (likely to be empty)
  let githubIssues = await githubHelper.getAllGithubIssues();

  console.log(`Transferring ${issues.length} issues.`);

  if (settings.usePlaceholderIssuesForMissingIssues) {
    for (let i = 0; i < issues.length; i++) {
      // GitLab issue internal Id (iid)
      let expectedIdx = i + 1;

      // is there a gap in the GitLab issues?
      // Create placeholder issues so that new GitHub issues will have the same
      // issue number as in GitLab. If a placeholder is used it is because there
      // was a gap in GitLab issues -- likely caused by a deleted GitLab issue.
      if (issues[i].iid !== expectedIdx) {
        issues.splice(i, 0, createPlaceholderIssue(expectedIdx));
        issueCounters.nrOfPlaceholderIssues++;
        console.log(
          `Added placeholder issue for GitLab issue #${expectedIdx}.`
        );
      }
    }
  }

  //
  // Create GitHub issues for each GitLab issue
  //

  // if a GitLab issue does not exist in GitHub repo, create it -- along with comments.
  for (let issue of issues) {
    // try to find a GitHub issue that already exists for this GitLab issue
    let githubIssue = githubIssues.find(
      i => i.title.trim() === issue.title.trim()
    );
    if (!githubIssue) {
      console.log(`\nMigrating issue #${issue.iid} ('${issue.title}')...`);
      try {
        // process asynchronous code in sequence -- treats the code sort of like blocking
        await githubHelper.createIssueAndComments(milestoneData, issue);
        console.log(`\t...DONE migrating issue #${issue.iid}.`);
      } catch (err) {
        console.log(`\t...ERROR while migrating issue #${issue.iid}.`);

        console.error('DEBUG:\n', err); // TODO delete this after issue-migration-fails have been fixed

        if (settings.useReplacementIssuesForCreationFails) {
          console.log('\t-> creating a replacement issue...');
          const replacementIssue = createReplacementIssue(
            issue.iid,
            issue.title,
            issue.state
          );

          try {
            await githubHelper.createIssueAndComments(
              milestoneData,
              replacementIssue
            );

            issueCounters.nrOfReplacementIssues++;
            console.error('\t...DONE.');
          } catch (err) {
            issueCounters.nrOfFailedIssues++;
            console.error(
              '\t...ERROR: Could not create replacement issue either!'
            );
          }
        }
      }
    } else {
      console.log(`Updating issue #${issue.iid} - ${issue.title}...`);
      try {
        await githubHelper.updateIssueState(githubIssue, issue);
        console.log(`...Done updating issue #${issue.iid}.`);
      } catch (err) {
        console.log(`...ERROR while updating issue #${issue.iid}.`);
      }
    }
  }

  // print statistics about issue migration:
  console.log(`DONE creating issues.`);
  console.log(`\n\tStatistics:`);
  console.log(`\tTotal nr. of issues: ${issues.length}`);
  console.log(
    `\tNr. of used placeholder issues: ${issueCounters.nrOfPlaceholderIssues}`
  );
  console.log(
    `\tNr. of used replacement issues: ${issueCounters.nrOfReplacementIssues}`
  );
  console.log(
    `\tNr. of issue migration fails: ${issueCounters.nrOfFailedIssues}`
  );
}
// ----------------------------------------------------------------------------

/**
 * Transfer any merge requests that exist in GitLab that do not exist in GitHub
 * TODO - Update all text references to use the new issue numbers;
 *        GitHub treats pull requests as issues, therefore their numbers are changed
 * @returns {Promise<void>}
 */
async function transferMergeRequests() {
  inform('Transferring Merge Requests');

  let milestoneData = await githubHelper.getAllGithubMilestones();

  // Get a list of all pull requests (merge request equivalent) associated with
  // this project
  let mergeRequests = await gitlabApi.MergeRequests.all({
    projectId: settings.gitlab.projectId,
    labels: settings.filterByLabel,
  }) as any[];

    // filter issues to only get those in state 'opened'
   if (settings.transfer.transferOnlyOpen) {
        console.log('Transferring only open merge requests');
        mergeRequests = mergeRequests.filter(mergeRequest => mergeRequest.state === 'opened');
    }

   if (settings.transfer.createdAfter) {
        console.log('Transferring merge requests created after ' + settings.transfer.createdAfter);
        mergeRequests = mergeRequests.filter(mergeRequest => Date.parse(mergeRequest.created_at) > Date.parse(settings.transfer.createdAfter));
    }

   if (settings.transfer.updatedAfter) {
        console.log('Transferring merge requests updated after ' + settings.transfer.updatedAfter);
        mergeRequests = mergeRequests.filter(mergeRequest => Date.parse(mergeRequest.updated_at) > Date.parse(settings.transfer.updatedAfter));
    }

  // Sort merge requests in ascending order of their number (by iid)
  mergeRequests = mergeRequests.sort((a, b) => a.iid - b.iid);

  // Get a list of the current pull requests in the new GitHub repo (likely to
  // be empty)
  let githubPullRequests = await githubHelper.getAllGithubPullRequests();

  // get a list of the current issues in the new GitHub repo (likely to be empty)
  // Issues are sometimes created from Gitlab merge requests. Avoid creating duplicates.
  let githubIssues = await githubHelper.getAllGithubIssues();

  console.log(
    'Transferring ' + mergeRequests.length.toString() + ' merge requests'
  );

  //
  // Create GitHub pull request for each GitLab merge request
  //

  // if a GitLab merge request does not exist in GitHub repo, create it -- along
  // with comments
  for (let request of mergeRequests) {
    // Try to find a GitHub pull request that already exists for this GitLab
    // merge request
    let githubRequest = githubPullRequests.find(
      i => i.title.trim() === request.title.trim()
    );
    let githubIssue = githubIssues.find(
      // allow for issues titled "Original Issue Name [merged]"
      i => i.title.trim().includes(request.title.trim())
    );
    if (!githubRequest && !githubIssue) {
      console.log(
        'Creating pull request: !' + request.iid + ' - ' + request.title
      );
      try {
        // process asynchronous code in sequence
        await githubHelper.createPullRequestAndComments(milestoneData, request);
      } catch (err) {
        console.error(
          'Could not create pull request: !' +
            request.iid +
            ' - ' +
            request.title
        );
        console.error(err);
      }
    } else {
      if (githubRequest) {
        console.log(
          'Gitlab merge request already exists (as github pull request): ' +
            request.iid +
            ' - ' +
            request.title
        );
        githubHelper.updatePullRequestState(githubRequest, request);
      } else {
        console.log(
          'Gitlab merge request already exists (as github issue): ' +
            request.iid +
            ' - ' +
            request.title
        );
      }
    }
  }
}

//-----------------------------------------------------------------------------

/**
 * logs merge requests that exist in GitLab to a file.
 */
async function logMergeRequests(logFile) {
  inform('Logging Merge Requests');

  // get a list of all GitLab merge requests associated with this project
  // TODO return all MRs via pagination
  let mergeRequests = await gitlabApi.MergeRequests.all({
    projectId: settings.gitlab.projectId,
    labels: settings.filterByLabel,
  }) as any;

  // sort MRs in ascending order of when they were created (by id)
  mergeRequests = mergeRequests.sort((a, b) => a.id - b.id);

  console.log('Logging ' + mergeRequests.length.toString() + ' merge requests');

  for (let mergeRequest of mergeRequests) {
    let mergeRequestDiscussions = await gitlabApi.MergeRequestDiscussions.all(
      settings.gitlab.projectId,
      mergeRequest.iid
    );
    let mergeRequestNotes = await gitlabApi.MergeRequestNotes.all(
      settings.gitlab.projectId,
      mergeRequest.iid,
      {}
    );

    mergeRequest.discussions = mergeRequestDiscussions
      ? mergeRequestDiscussions
      : [];
    mergeRequest.notes = mergeRequestNotes ? mergeRequestNotes : [];
  }

  //
  // Log the merge requests to a file
  //
  const output = {
    mergeRequests: mergeRequests,
  };

  fs.writeFileSync(logFile, JSON.stringify(output, null, 2));
}

// ----------------------------------------------------------------------------

/**
 * Print out a section heading to let the user know what is happening
 */
function inform(msg) {
  console.log('==================================');
  console.log(msg);
  console.log('==================================');
}
