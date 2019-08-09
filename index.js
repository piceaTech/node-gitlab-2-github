const GitHubApi = require('@octokit/rest');
const Gitlab = require('gitlab').default;
const async = require('async');
const fs = require('fs');

const sleep = milliseconds => {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
};

var settings = null;
try {
  settings = require('./settings.js');
} catch (e) {
  if (e.code === 'MODULE_NOT_FOUND') {
    console.log('\n\nPlease copy the sample_settings.js to settings.js.');
  } else {
    console.log(e);
  }

  process.exit(1);
}

// Ensure that the GitLab URL and token has been set in settings.js
if (
  !settings.gitlab.url ||
  settings.gitlab.url === 'http://gitlab.mycompany.com/'
) {
  console.log('\n\nYou have to enter your GitLab url in the settings.js file.');
  process.exit(1);
}
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
var gitlab = new Gitlab({
  url: settings.gitlab.url,
  token: settings.gitlab.token,
});

// Create a GitHub API object
var github = new GitHubApi({
  debug: false,
  baseUrl: settings.github.baseUrl
    ? settings.github.baseUrl
    : 'https://api.github.com',
  timeout: 5000,
  headers: {
    'user-agent': 'node-gitlab-2-github', // GitHub is happy with a unique user agent
    accept: 'application/vnd.github.v3+json',
  },
});

// regex for converting user from GitLab to GitHub
var userProjectRe = generateUserProjectRe();

// If no project id is given in settings.js, just return
// all of the projects that this user is associated with.
if (settings.gitlab.projectId === null) {
  listProjects();
} else {
  // user has chosen a project
  migrate();
}

// ----------------------------------------------------------------------------

/**
 * List all projects that the GitLab user is associated with.
 */
async function listProjects() {
  try {
    let projects = await gitlab.Projects.all({ membership: true });

    // print each project with info
    for (let i = 0; i < projects.length; i++) {
      console.log(
        projects[i].id.toString(),
        '\t',
        projects[i].name,
        '\t--\t',
        projects[i].description
      );
    }

    // instructions for user
    console.log('\n\n');
    console.log(
      'Select which project ID should be transported to github. Edit the settings.js accordingly. (gitlab.projectID)'
    );
    console.log('\n\n');
  } catch (err) {
    console.error('An Error occured while fetching all projects:');
    console.error(err);
  }
}

// ----------------------------------------------------------------------------

/**
 * Performs all of the migration tasks to move a GitLab repo to GitHub
 */
async function migrate() {
  github.authenticate({
    type: 'token',
    token: settings.github.token,
  });

  //
  // Sequentially transfer repo things
  //

  // transfer GitLab milestones to GitHub
  await transferMilestones(settings.gitlab.projectId);

  // transfer GitLab labels to GitHub
  await transferLabels(
    settings.gitlab.projectId,
    true,
    settings.conversion.useLowerCaseLabels
  );

  // Transfer issues with their comments; do this before transferring the merge requests
  await transferIssues(
    settings.github.owner,
    settings.github.repo,
    settings.gitlab.projectId
  );

  if (settings.mergeRequests.log) {
    // log merge requests
    await logMergeRequests(
      settings.gitlab.projectId,
      settings.mergeRequests.logFile
    );
  } else {
    await transferMergeRequests(
      settings.github.owner,
      settings.github.repo,
      settings.gitlab.projectId
    );
  }

  console.log('\n\nTransfer complete!\n\n');
}

// ----------------------------------------------------------------------------

/**
 * Transfer any milestones that exist in GitLab that do not exist in GitHub.
 */
async function transferMilestones(projectId) {
  inform('Transferring Milestones');

  // Get a list of all milestones associated with this project
  let milestones = await gitlab.ProjectMilestones.all(projectId);

  // sort milestones in ascending order of when they were created (by id)
  milestones = milestones.sort((a, b) => a.id - b.id);

  // get a list of the current milestones in the new GitHub repo (likely to be empty)
  let ghMilestones = await getAllGHMilestones(
    settings.github.owner,
    settings.github.repo
  );

  // if a GitLab milestone does not exist in GitHub repo, create it.
  for (let milestone of milestones) {
    if (!ghMilestones.find(m => m.title === milestone.title)) {
      console.log('Creating: ' + milestone.title);
      try {
        // process asynchronous code in sequence
        await createMilestone(
          settings.github.owner,
          settings.github.repo,
          milestone
        );
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
async function transferLabels(
  projectId,
  attachmentLabel = true,
  useLowerCase = true
) {
  inform('Transferring Labels');

  // Get a list of all labels associated with this project
  let labels = await gitlab.Labels.all(projectId);

  // get a list of the current label names in the new GitHub repo (likely to be just the defaults)
  let ghLabels = await getAllGHLabelNames(
    settings.github.owner,
    settings.github.repo
  );

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

    if (!ghLabels.find(l => l === label.name)) {
      console.log('Creating: ' + label.name);
      try {
        // process asynchronous code in sequence
        await createLabel(
          settings.github.owner,
          settings.github.repo,
          label
        ).catch(x => {});
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
async function transferIssues(owner, repo, projectId) {
  inform('Transferring Issues');

  // Because each
  let milestoneData = await getAllGHMilestones(owner, repo);

  // get a list of all GitLab issues associated with this project
  // TODO return all issues via pagination
  let issues = await gitlab.Issues.all({ projectId: projectId });

  // sort issues in ascending order of their issue number (by iid)
  issues = issues.sort((a, b) => a.iid - b.iid);

  // get a list of the current issues in the new GitHub repo (likely to be empty)
  let ghIssues = await getAllGHIssues(
    settings.github.owner,
    settings.github.repo
  );

  console.log('Transferring ' + issues.length.toString() + ' issues');

  //
  // Create Placeholder Issues
  //

  for (let i = 0; i < issues.length; i++) {
    // GitLab issue internal Id (iid)
    let expectedIdx = i + 1;

    // is there a gap in the GitLab issues?
    // Create placeholder issues so that new GitHub issues will have the same
    // issue number as in GitLab. If a placeholder is used it is because there
    // was a gap in GitLab issues -- likely caused by a deleted GitLab issue.
    if (issues[i].iid != expectedIdx) {
      issues.splice(i, 0, {
        iid: expectedIdx,
        title: `placeholder issue for issue ${expectedIdx} which does not exist and was probably deleted in GitLab`,
        description:
          'This is to ensure the issue numbers in GitLab and GitHub are the same',
        state: 'closed',
      });
      i++;
      console.log('Added placeholder issue for GitLab issue #' + expectedIdx);
    }
  }

  //
  // Create GitHub issues for each GitLab issue
  //

  // if a GitLab issue does not exist in GitHub repo, create it -- along with comments.
  for (let issue of issues) {
    // try to find a GitHub issue that already exists for this GitLab issue
    let ghIssue = ghIssues.find(i => i.title.trim() === issue.title.trim());
    if (!ghIssue) {
      console.log('Creating: ' + issue.iid + ' - ' + issue.title);
      try {
        // process asynchronous code in sequence -- treats the code sort of like blocking
        await createIssueAndComments(
          settings.github.owner,
          settings.github.repo,
          milestoneData,
          issue
        );
      } catch (err) {
        console.error(
          'Could not create issue: ' + issue.iid + ' - ' + issue.title
        );
        console.error(err);
      }
    } else {
      console.log('Already exists: ' + issue.iid + ' - ' + issue.title);
      updateIssueState(ghIssue, issue);
    }
  }
}
// ----------------------------------------------------------------------------

/**
 * Transfer any merge requests that exist in GitLab that do not exist in GitHub
 * TODO - Update all text references to use the new issue numbers;
 *        GitHub treats pull requests as issues, therefore their numbers are changed
 * @param owner the owner of the GitHub repository
 * @param repo the name of the GitHub repository
 * @param projectId the Id of the GitLab repository that is being transferred
 * @returns {Promise<void>}
 */
async function transferMergeRequests(owner, repo, projectId) {
  inform('Transferring Merge Requests');

  let milestoneData = await getAllGHMilestones(owner, repo);

  // Get a list of all pull requests (merge request equivalent) associated with
  // this project
  let mergeRequests = await gitlab.MergeRequests.all({ projectId: projectId });

  // Sort merge requests in ascending order of their number (by iid)
  mergeRequests = mergeRequests.sort((a, b) => a.iid - b.iid);

  // Get a list of the current pull requests in the new GitHub repo (likely to
  // be empty)
  let ghPullRequests = await getAllGHPullRequests(
    settings.github.owner,
    settings.github.repo
  );

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
    let ghRequest = ghPullRequests.find(
      i => i.title.trim() === request.title.trim()
    );
    if (!ghRequest) {
      console.log(
        'Creating pull request: !' + request.iid + ' - ' + request.title
      );
      try {
        // process asynchronous code in sequence
        await createPullRequestAndComments(
          settings.github.owner,
          settings.github.repo,
          milestoneData,
          request
        );
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
      console.log(
        'Pull request already exists: ' + request.iid + ' - ' + request.title
      );
      updatePullRequestState(ghRequest, request);
    }
  }
}

//-----------------------------------------------------------------------------

/**
 * logs merge requests that exist in GitLab to a file.
 */
async function logMergeRequests(projectId, logFile) {
  inform('Logging Merge Requests');

  // get a list of all GitLab merge requests associated with this project
  // TODO return all MRs via pagination
  let mergeRequests = await gitlab.MergeRequests.all({ projectId: projectId });

  // sort MRs in ascending order of when they were created (by id)
  mergeRequests = mergeRequests.sort((a, b) => a.id - b.id);

  console.log('Logging ' + mergeRequests.length.toString() + ' merge requests');

  for (let mergeRequest of mergeRequests) {
    let mergeRequestDiscussions = await gitlab.MergeRequestDiscussions.all(
      projectId,
      mergeRequest.iid
    );
    let mergeRequestNotes = await gitlab.MergeRequestNotes.all(
      projectId,
      mergeRequest.iid
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
 * Get a list of all GitHub milestones currently in new repo
 */
async function getAllGHMilestones(owner, repo) {
  try {
    await sleep(2000);
    // get an array of GitHub milestones for the new repo
    let result = await github.issues.listMilestonesForRepo({
      owner: owner,
      repo: repo,
      state: 'all',
    });

    // extract the milestone number and title and put into a new array
    let milestones = result.data.map(x => ({
      number: x.number,
      title: x.title,
    }));

    return milestones;
  } catch (err) {
    console.error('Could not access all GitHub milestones');
    console.error(err);
    process.exit(1);
  }
}

// ----------------------------------------------------------------------------

/**
 * Get a list of all GitHub label names currently in new repo
 */
async function getAllGHLabelNames(owner, repo) {
  try {
    await sleep(2000);
    // get an array of GitHub labels for the new repo
    let result = await github.issues.listLabelsForRepo({
      owner: owner,
      repo: repo,
    });

    // extract the label name and put into a new array
    let labels = result.data.map(x => x.name);

    return labels;
  } catch (err) {
    console.error('Could not access all GitHub label names');
    console.error(err);
    process.exit(1);
  }
}

// ----------------------------------------------------------------------------

/**
 * Get a list of all the current GitHub issues.
 * This uses a while loop to make sure that each page of issues is received.
 */
async function getAllGHIssues(owner, repo) {
  let allIssues = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    await sleep(2000);
    // get a paginated list of issues
    const issues = await github.issues.listForRepo({
      owner: owner,
      repo: repo,
      state: 'all',
      per_page: perPage,
      page: page,
    });

    // if this page has zero issues then we are done!
    if (issues.data.length === 0) break;

    // join this list of issues with the master list
    allIssues = allIssues.concat(issues.data);

    // if there are strictly less issues on this page than the maximum number per page
    // then we can be sure that this is all the issues. No use querying again.
    if (issues.data.length < perPage) break;

    // query for the next page of issues next iteration
    page++;
  }

  return allIssues;
}

// ----------------------------------------------------------------------------

/**
 * Get a list of all the current GitHub pull requests.
 * This uses a while loop to make sure that each page of issues is received.
 */
async function getAllGHPullRequests(owner, repo) {
  let allPullRequests = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    await sleep(2000);
    // get a paginated list of pull requests
    const pullRequests = await github.pulls.list({
      owner: owner,
      repo: repo,
      state: 'all',
      per_page: perPage,
      page: page,
    });

    // if this page has zero PRs then we are done!
    if (pullRequests.data.length === 0) break;

    // join this list of PRs with the master list
    allPullRequests = allPullRequests.concat(pullRequests.data);

    // if there are strictly less PRs on this page than the maximum number per page
    // then we can be sure that this is all the PRs. No use querying again.
    if (pullRequests.data.length < perPage) break;

    // query for the next page of PRs next iteration
    page++;
  }

  return allPullRequests;
}

// ----------------------------------------------------------------------------

/**
 * Create a pull request, set its data, and set its comments
 * @param owner the GitHub repository owner (user)
 * @param repo the GitHub repository name
 * @param milestones a list of the milestones that exist in the GitHub repository
 * @param pullRequest the GitLab pull request that we want to migrate
 * @returns {Promise<void>}
 */
async function createPullRequestAndComments(
  owner,
  repo,
  milestones,
  pullRequest
) {
  let ghPullRequestData = await createPullRequest(owner, repo, pullRequest);
  let ghPullRequest = ghPullRequestData.data;

  // data is set to null if one of the branches does not exist and the pull request cannot be created
  if (ghPullRequest) {
    // Add milestones, labels, and other attributes from the Issues API
    await updatePullRequestData(ghPullRequest, pullRequest, milestones);

    // add any comments/nodes associated with this pull request
    await createPullRequestComments(ghPullRequest, pullRequest);

    // Make sure to close the GitHub pull request if it is closed or merged in GitLab
    await updatePullRequestState(ghPullRequest, pullRequest);
  }
}

// ----------------------------------------------------------------------------

/**
 * Create a pull request. A pull request can only be created if both the target and source branches exist on the GitHub
 * repository. In many cases, the source branch is deleted when the merge occurs, and the merge request may not be able
 * to be migrated. In this case, an issue is created instead with a 'gitlab merge request' label.
 * @param owner the owner (user) of the GitHub repository
 * @param repo the name of the GitHub repository
 * @param pullRequest the GitLab pull request object that we want to duplicate
 * @returns {Promise<Promise<{data: null}>|Promise<Github.Response<Github.PullsCreateResponse>>|Promise<{data: *}>>}
 */
async function createPullRequest(owner, repo, pullRequest) {
  let canCreate = true;

  // Check to see if the target branch exists in GitHub - if it does not exist, we cannot create a pull request
  try {
    await github.repos.getBranch({
      owner: owner,
      repo: repo,
      branch: pullRequest.target_branch,
    });
  } catch (err) {
    let glBranches = await gitlab.Branches.all(settings.gitlab.projectId);
    if (glBranches.find(m => m.name === pullRequest.target_branch)) {
      // Need to move that branch over to GitHub!
      console.error(
        'The ' +
          pullRequest.target_branch +
          ' branch exists on GitLab but has not been migrated to GitHub.' +
          ' Please migrate the branch before migrating merge request !' +
          pullRequest.iid
      );
      return Promise.resolve({ data: null });
    } else {
      console.error(
        'Merge request !' +
          pullRequest.iid +
          ', target branch: ' +
          pullRequest.target_branch +
          ' does not exist'
      );
      console.error(
        'Thus, cannot migrate merge request; creating an issue instead'
      );
      canCreate = false;
    }
  }

  // Check to see if the source branch exists in GitHub - if it does not exist, we cannot create a pull request
  try {
    await github.repos.getBranch({
      owner: owner,
      repo: repo,
      branch: pullRequest.source_branch,
    });
  } catch (err) {
    let glBranches = await gitlab.Branches.all(settings.gitlab.projectId);
    if (glBranches.find(m => m.name === pullRequest.source_branch)) {
      // Need to move that branch over to GitHub!
      console.error(
        'The ' +
          pullRequest.source_branch +
          ' branch exists on GitLab but has not been migrated to GitHub.' +
          ' Please migrate the branch before migrating merge request !' +
          pullRequest.iid
      );
      return Promise.resolve({ data: null });
    } else {
      console.error(
        'Merge request !' +
          pullRequest.iid +
          ', source branch: ' +
          pullRequest.source_branch +
          ' does not exist'
      );
      console.error(
        'Thus, cannot migrate merge request; creating an issue instead'
      );
      canCreate = false;
    }
  }

  if (settings.debug) return Promise.resolve({ data: pullRequest });

  if (canCreate) {
    let bodyConverted = convertIssuesAndComments(
      pullRequest.description,
      pullRequest
    );

    // GitHub API Documentation to create a pull request: https://developer.github.com/v3/pulls/#create-a-pull-request
    let props = {
      owner: owner,
      repo: repo,
      title: pullRequest.title.trim(),
      body: bodyConverted,
      head: pullRequest.source_branch,
      base: pullRequest.target_branch,
    };

    await sleep(2000);

    // create the GitHub pull request from the GitLab issue
    return github.pulls.create(props);
  } else {
    // Create an issue with a descriptive title
    let mergeStr =
      '_Merges ' +
      pullRequest.source_branch +
      ' -> ' +
      pullRequest.target_branch +
      '_\n\n';
    let bodyConverted = convertIssuesAndComments(
      mergeStr + pullRequest.description,
      pullRequest
    );
    let props = {
      owner: owner,
      repo: repo,
      title: pullRequest.title.trim() + ' - [' + pullRequest.state + ']',
      body: bodyConverted,
    };

    // Add a label to indicate the issue is a merge request
    pullRequest.labels.push('gitlab merge request');

    return github.issues.create(props);
  }
}

// ----------------------------------------------------------------------------

/**
 * Create comments for the pull request
 * @param ghPullRequest the GitHub pull request object
 * @param pullRequest the GitLab pull request object
 * @returns {Promise<void>}
 */
async function createPullRequestComments(ghPullRequest, pullRequest) {
  if (!pullRequest.iid) {
    console.log(
      'This is a placeholder for a deleted GitLab merge request; no comments are created'
    );
    return Promise.resolve();
  }

  // retrieve any notes/comments associated with this merge request
  try {
    let notes = await gitlab.MergeRequestNotes.all(
      settings.gitlab.projectId,
      pullRequest.iid
    );

    // If there are no nodes, then there is nothing to do!
    if (notes.length == 0) return;

    // Sort notes in ascending order of when they were created (by id)
    notes = notes.sort((a, b) => a.id - b.id);

    for (let note of notes) {
      if (
        (/Status changed to .*/i.test(note.body) &&
          !/Status changed to closed by commit.*/i.test(note.body)) ||
        /changed milestone to .*/i.test(note.body) ||
        /Milestone changed to .*/i.test(note.body) ||
        /Reassigned to /i.test(note.body) ||
        /added .* labels/i.test(note.body) ||
        /Added ~.* label/i.test(note.body) ||
        /removed ~.* label/i.test(note.body) ||
        /mentioned in issue.*/i.test(note.body)
      ) {
        // Don't transfer when the state changed (this is a note in GitLab)
      } else {
        let bodyConverted = convertIssuesAndComments(note.body, note);

        await sleep(2000);

        if (settings.debug) {
          console.log(bodyConverted);
          return Promise.resolve();
        }
        // Use the GitHub Issues API to create comments (all pull requests are issues); Pull request comments are more
        // specialized: see <https://developer.github.com/v3/pulls/comments/>
        await github.issues
          .createComment({
            owner: settings.github.owner,
            repo: settings.github.repo,
            number: ghPullRequest.number,
            body: bodyConverted,
          })
          .catch(x => {
            console.error('could not create GitHub pull request comment!');
            console.error(x);
            process.exit(1);
          });
      }
    }
  } catch (err) {
    console.error(
      'could not fetch notes for GitLab merge request !' + pullRequest.iid
    );
    console.error(err);
  }
}

// ----------------------------------------------------------------------------

/**
 * Update the pull request data. The GitHub Pull Request API does not supply mechanisms to set the milestone, assignee,
 * or labels; these data are set via the Issues API in this function
 * @param ghPullRequest the GitHub pull request object
 * @param pullRequest the GitLab pull request object
 * @param milestones a list of Milestones that exist in the GitHub repo
 * @returns {Promise<Github.Response<Github.IssuesUpdateResponse>>}
 */
async function updatePullRequestData(ghPullRequest, pullRequest, milestones) {
  let props = {
    owner: settings.github.owner,
    repo: settings.github.repo,
    number: ghPullRequest.number || ghPullRequest.iid,
  };

  //
  // Pull Request Assignee
  //

  // If the GitLab merge request has an assignee, make sure to carry it over --
  // but only if the username is a valid GitHub username
  if (pullRequest.assignee) {
    props.assignees = [];
    if (pullRequest.assignee.username == settings.github.username) {
      props.assignees.push(settings.github.username);
    } else if (
      settings.usermap &&
      settings.usermap[pullRequest.assignee.username]
    ) {
      // Get GitHub username from settings
      props.assignees.push(settings.usermap[pullRequest.assignee.username]);
    }
  }

  //
  // Pull Request Milestone
  //

  // if the GitLab merge request has an associated milestone, make sure to attach it
  if (pullRequest.milestone) {
    let milestone = milestones.find(
      m => m.title === pullRequest.milestone.title
    );
    if (milestone) {
      props.milestone = milestone.number;
    }
  }

  //
  // Merge Request Labels
  //

  // make sure to add any labels that existed in GitLab
  if (pullRequest.labels) {
    props.labels = pullRequest.labels.filter(l => {
      if (pullRequest.state != 'closed') return true;

      let lower = l.toLowerCase();
      // ignore any labels that should have been removed when the issue was closed
      return lower != 'doing' && lower != 'to do';
    });
  }

  return await github.issues.update(props);
}

// ----------------------------------------------------------------------------

/**
 * Update the pull request state
 * @param ghPullRequest GitHub pull request object
 * @param pullRequest GitLab pull request object
 * @returns {Promise<Promise<Github.AnyResponse>|Github.Response<Github.PullsUpdateResponse>|Promise<void>>}
 */
async function updatePullRequestState(ghPullRequest, pullRequest) {
  if (
    pullRequest.state == 'merged' &&
    ghPullRequest.state != 'closed' &&
    !settings.debug
  ) {
    // Merging the pull request adds new commits to the tree; to avoid that, just close the merge requests
    pullRequest.state = 'closed';
  }

  // Default state is open so we don't have to update if the request is closed
  if (pullRequest.state != 'closed' || ghPullRequest.state == 'closed') return;

  let props = {
    owner: settings.github.owner,
    repo: settings.github.repo,
    number: ghPullRequest.number,
    state: pullRequest.state,
  };

  await sleep(2000);

  if (settings.debug) {
    return Promise.resolve();
  }

  // Use the Issues API; all pull requests are issues, and we're not modifying any pull request-sepecific fields. This
  // then works for merge requests that cannot be created and are migrated as issues.
  return await github.issues.update(props);
}

// ----------------------------------------------------------------------------

/**
 *
 */
async function createIssueAndComments(owner, repo, milestones, issue) {
  // create the issue in GitHub
  let ghIssueData = await createIssue(owner, repo, milestones, issue);
  let ghIssue = ghIssueData.data;

  // add any comments/notes associated with this issue
  await createIssueComments(ghIssue, issue);

  // make sure to close the GitHub issue if it is closed in GitLab
  await updateIssueState(ghIssue, issue);
}

// ----------------------------------------------------------------------------

/**
 *
 */
async function createIssue(owner, repo, milestones, issue) {
  let bodyConverted = convertIssuesAndComments(issue.description, issue);

  let props = {
    owner: owner,
    repo: repo,
    title: issue.title.trim(),
    body: bodyConverted,
  };

  //
  // Issue Assignee
  //

  // If the GitLab issue has an assignee, make sure to carry it over -- but only
  // if the username is a valid GitHub username.
  if (issue.assignee) {
    props.assignees = [];
    if (issue.assignee.username == settings.github.username) {
      props.assignees.push(settings.github.username);
    } else if (settings.usermap && settings.usermap[issue.assignee.username]) {
      // get GitHub username name from settings
      props.assignees.push(settings.usermap[issue.assignee.username]);
    }
  }

  //
  // Issue Milestone
  //

  // if the GitLab issue has an associated milestone, make sure to attach it.
  if (issue.milestone) {
    let milestone = milestones.find(m => m.title === issue.milestone.title);
    if (milestone) {
      props.milestone = milestone.number;
    }
  }

  //
  // Issue Labels
  //

  // make sure to add any labels that existed in GitLab
  if (issue.labels) {
    props.labels = issue.labels.filter(l => {
      if (issue.state != 'closed') return true;

      let lower = l.toLowerCase();
      // ignore any labels that should have been removed when the issue was closed
      return lower != 'doing' && lower != 'to do';
    });
  }

  //
  // Issue Attachments
  //

  // if the issue contains a url that contains "/uploads/", it is likely to
  // have an attachment. Therefore, add the "has attachment" label.
  if (props.body && props.body.indexOf('/uploads/') > -1) {
    props.labels.push('has attachment');
  }
  await sleep(2000);

  if (settings.debug) return Promise.resolve({ data: issue });
  // create the GitHub issue from the GitLab issue
  return github.issues.create(props);
}

// ----------------------------------------------------------------------------

/**
 *
 */
async function createIssueComments(ghIssue, issue) {
  // retrieve any notes/comments associated with this issue
  if (!issue.iid) {
    console.log('Placeholder issue; no comments are migrated.');
    return;
  }

  try {
    let notes = await gitlab.IssueNotes.all(
      settings.gitlab.projectId,
      issue.iid
    );

    // if there are no notes, then there is nothing to do!
    if (notes.length == 0) return;

    // sort notes in ascending order of when they were created (by id)
    notes = notes.sort((a, b) => a.id - b.id);

    for (let note of notes) {
      if (
        (/Status changed to .*/i.test(note.body) &&
          !/Status changed to closed by commit.*/i.test(note.body)) ||
        /changed milestone to .*/i.test(note.body) ||
        /Milestone changed to .*/i.test(note.body) ||
        /Reassigned to /i.test(note.body) ||
        /added .* labels/i.test(note.body) ||
        /Added ~.* label/i.test(note.body) ||
        /removed ~.* label/i.test(note.body) ||
        /mentioned in issue.*/i.test(note.body)
      ) {
        // Don't transfer when the state changed (this is a note in GitLab)
      } else {
        let bodyConverted = convertIssuesAndComments(note.body, note);

        await sleep(2000);

        if (settings.debug) {
          console.log(bodyConverted);
          return Promise.resolve();
        }
        // process asynchronous code in sequence -- treats kind of like blocking
        await github.issues
          .createComment({
            owner: settings.github.owner,
            repo: settings.github.repo,
            number: ghIssue.number,
            body: bodyConverted,
          })
          .catch(x => {
            console.error('could not create GitHub issue comment!');
            console.error(x);
            process.exit(1);
          });
      }
    }
  } catch (err) {
    console.error('Could not fetch notes for GitLab issue #' + issue.number);
    console.error(err);
  }
}

// ----------------------------------------------------------------------------

/**
 * Update the issue state (i.e., closed or open).
 */
async function updateIssueState(ghIssue, issue) {
  // default state is open so we don't have to update if the issue is closed.
  if (issue.state != 'closed' || ghIssue.state == 'closed') return;

  let props = {
    owner: settings.github.owner,
    repo: settings.github.repo,
    number: ghIssue.number,
    state: issue.state,
  };

  await sleep(2000);

  if (settings.debug) {
    return Promise.resolve();
  }
  // make the state update
  return await github.issues.update(props);
}

// ----------------------------------------------------------------------------

/**
 * Create a GitHub milestone from a GitLab milestone
 */
async function createMilestone(owner, repo, milestone) {
  // convert from GitLab to GitHub
  let ghMilestone = {
    owner: owner,
    repo: repo,
    title: milestone.title,
    description: milestone.description,
    state: milestone.state === 'active' ? 'open' : 'closed',
  };

  if (milestone.due_date) {
    ghMilestone.due_on = milestone.due_date + 'T00:00:00Z';
  }

  await sleep(2000);

  if (settings.debug) return Promise.resolve();
  // create the GitHub milestone
  return await github.issues.createMilestone(ghMilestone);
}

// ----------------------------------------------------------------------------

/**
 * Create a GitHub label from a GitLab label
 */
async function createLabel(owner, repo, label) {
  // convert from GitLab to GitHub
  let ghLabel = {
    owner: settings.github.owner,
    repo: settings.github.repo,
    name: label.name,
    color: label.color.substr(1), // remove leading "#" because gitlab returns it but github wants the color without it
  };

  await sleep(2000);

  if (settings.debug) return Promise.resolve();
  // create the GitHub label
  return await github.issues.createLabel(ghLabel);
}

// ----------------------------------------------------------------------------

/**
 * Converts issue body and issue comments from GitLab to GitHub. That means:
 * - Add a line at the beginning indicating which original user created the
 *   issue or the comment and when - because the GitHub API creates everything
 *   as the API user
 * - Change username from GitLab to GitHub in "mentions" (@username)
 */
function convertIssuesAndComments(str, item) {
  if (
    (settings.usermap == null || Object.keys(settings.usermap).length == 0) &&
    (settings.projectmap == null ||
      Object.keys(settings.projectmap).length == 0)
  ) {
    return addMigrationLine(str, item);
  } else {
    // - Replace userids as defined in settings.usermap.
    //   They all start with '@' in the issues but we have them without in usermap
    // - Replace cross-project issue references. They are matched on org/project# so 'matched' ends with '#'
    //   They all have a '#' right after the project name in the issues but we have them without in projectmap
    let strWithMigLine = addMigrationLine(str, item);

    strWithMigLine = strWithMigLine.replace(userProjectRe, matched => {
      if (matched.startsWith('@')) {
        // this is a userid
        return '@' + settings.usermap[matched.substr(1)];
      } else if (matched.endsWith('#')) {
        // this is a cross-project issue reference
        return (
          settings.projectmap[matched.substring(0, matched.length - 1)] + '#'
        );
      } else {
        // something went wrong, do nothing
        return matched;
      }
    });

    return strWithMigLine;
  }
}

// ----------------------------------------------------------------------------

/**
 * Adds a line of text at the beginning of a comment that indicates who, when
 * and from GitLab.
 */
function addMigrationLine(str, item) {
  if (
    item == null ||
    item.author == null ||
    item.author.username == null ||
    item.created_at == null
  ) {
    return str;
  }

  var dateformatOptions = {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  };

  var formattedDate = new Date(item.created_at).toLocaleString(
    'en-US',
    dateformatOptions
  );

  return (
    'In GitLab by @' +
    item.author.username +
    ' on ' +
    formattedDate +
    '\n\n' +
    str
  );
}

// ----------------------------------------------------------------------------

/**
 * Generate regular expression which finds userid and cross-project issue references
 * from usermap and projectmap
 */
function generateUserProjectRe() {
  var reString = '';
  if (settings.usermap != null && Object.keys(settings.usermap).length > 0) {
    reString = '@' + Object.keys(settings.usermap).join('|@');
  }
  if (
    settings.projectmap != null &&
    Object.keys(settings.projectmap).length > 0
  ) {
    if (reString.length > 0) {
      reString += '|';
    }
    reString += Object.keys(settings.projectmap).join('#|') + '#';
  }

  return new RegExp(reString, 'g');
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
