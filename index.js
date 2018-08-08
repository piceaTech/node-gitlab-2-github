const GitHubApi = require('@octokit/rest')
const Gitlab = require('gitlab').default
const async = require('async');

try {
  var settings = require('./settings.js');
} catch(e) {
  if (e.code === 'MODULE_NOT_FOUND') {
    console.log('\n\nPlease copy the sample_settings.js to settings.js.');
  } else {
    console.log(e);
  }
  
  process.exit(1);
}

// Ensure that the GitLab URL and token has been set in settings.js
if (!settings.gitlab.url || settings.gitlab.url === "http://gitlab.mycompany.com/") {
  console.log('\n\nYou have to enter your GitLab url in the settings.js file.');
  process.exit(1);
}
if (!settings.gitlab.token || settings.gitlab.token === "{{gitlab private token}}") {
  console.log('\n\nYou have to enter your GitLab private token in the settings.js file.');
  process.exit(1);
}

// Create a GitLab API object
var gitlab = new Gitlab({
  url: settings.gitlab.url,
  token: settings.gitlab.token
});

// Create a GitHub API object
var github = new GitHubApi({
  debug: false,
  baseUrl: (settings.github.baseUrl?settings.github.baseUrl:"https://api.github.com"),
  timeout: 5000,
  headers: {
    'user-agent': 'node-gitlab-2-github', // GitHub is happy with a unique user agent
    'accept': 'application/vnd.github.v3+json',
  }
});

// regex for converting user from GitLab to GitHub
var userProjectRe = generateUserProjectRe();

// If no project id is given in settings.js, just return
// all of the projects that this user is associated with.
if (settings.gitlab.projectID === null) {
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
    let projects = await gitlab.Projects.all({membership: true});

    // print each project with info
    for (let i = 0; i < projects.length; i++) {
      console.log(projects[i].id.toString(), '\t', projects[i].name, '\t--\t', projects[i].description);
    }

    // instructions for user
    console.log('\n\n');
    console.log('Select which project ID should be transported to github. Edit the settings.js accordingly. (gitlab.projectID)');
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
    type: "basic",
    username: settings.github.username,
    password: settings.github.token
  });

  // transfer GitLab milestones to GitHub
  transferMilestones(settings.gitlab.projectId);

  // transfer GitLab labels to GitHub
  transferLabels(settings.gitlab.projectId, true, settings.conversion.useLowerCaseLabels);

  // Transfer issues with their comments
  transferIssues(settings.github.owner, settings.github.repo, settings.gitlab.projectId);
}

// ----------------------------------------------------------------------------

/**
 * Transfer any milestones that exist in GitLab that do not exist in GitHub.
 */
async function transferMilestones(projectId) {
  // Get a list of all milestones associated with this project
  let milestones = await gitlab.ProjectMilestones.all(projectId);

  // sort milestones in ascending order of when they were created (by id)
  milestones = milestones.sort((a, b) => a.id - b.id);

  // get a list of the current milestones in the new GitHub repo (likely to be empty)
  let ghMilestones = await getAllGHMilestones(settings.github.owner, settings.github.repo);

  inform("Transferring Milestones");

  // if a GitLab milestone does not exist in GitHub repo, create it.
  for (let milestone of milestones) {
      if (!ghMilestones.find(m => m.title === milestone.title)) {
        console.log("Creating: " + milestone.title);
        try {

          // process asynchronous code in sequence
          await (() => {
            createMilestone(settings.github.owner, settings.github.repo, milestone);
          })(milestone);

        } catch (err) {
          console.error("Could not create milestone", milestone.title);
          console.error(err);
        }
      } else {
        console.log("Already exists: " + milestone.title);
      }
  };

}

// ----------------------------------------------------------------------------

/**
 * Transfer any labels that exist in GitLab that do not exist in GitHub.
 */
async function transferLabels(projectId, attachmentLabel = true, useLowerCase = true) {
  // Get a list of all labels associated with this project
  let labels = await gitlab.Labels.all(projectId);

  // get a list of the current label names in the new GitHub repo (likely to be just the defaults)
  let ghLabels = await getAllGHLabelNames(settings.github.owner, settings.github.repo);

  inform("Transferring Labels")

  // create a hasAttachment label for manual attachment migration
  if (attachmentLabel) {
    const hasAttachmentLabel = {name: 'has attachment', color: '#fbca04'};
    labels.push(hasAttachmentLabel);
  }

  // if a GitLab label does not exist in GitHub repo, create it.
  for (let label of labels) {

      // GitHub prefers lowercase label names
      if (useLowerCase) {
        label.name = label.name.toLowerCase()
      }

      if (!ghLabels.find(l => l === label.name)) {
        console.log("Creating: " + label.name);
        try {

          // process asynchronous code in sequence
          await (() => {
            createLabel(settings.github.owner, settings.github.repo, label).catch(x=>{});
          })(label);

        } catch (err) {
          console.error("Could not create label", label.name);
          console.error(err);
        }
      } else {
        console.log("Already exists: " + label.name);
      }
  };
}

// ----------------------------------------------------------------------------

/**
 * Transfer any issues and their comments that exist in GitLab that do not exist in GitHub.
 */
async function transferIssues(owner, repo, projectId) {

  // Because each 
  let milestoneData = await getAllGHMilestones(owner, repo);

  // get a list of all GitLab issues associated with this project
  // TODO return all issues via pagination
  let issues = await gitlab.Issues.all({projectId: projectId});

  // sort issues in ascending order of when they were created (by id)
  issues = issues.sort((a, b) => a.id - b.id);

  // get a list of the current issues in the new GitHub repo (likely to be empty)
  let ghIssues = await getAllGHIssues(settings.github.owner, settings.github.repo);

  inform("Transferring " + issues.length.toString() + " Issues");

  //
  // Create Placeholder Issues
  //

  // Create placeholder issues so that new GitHub issues will have the same
  // issue number as in GitLab. If a placeholder is used it is because there
  // was a gap in GitLab issues -- likely caused by a deleted GitLab issue.
  const placeholderItem = {
    title: 'placeholder issue for issue which does not exist and was probably deleted in GitLab',
    description: 'This is to ensure the issue numbers in GitLab and GitHub are the same',
    state: 'closed'
  }

  for (let i=0; i<issues.length; i++) {
    // GitLab issue internal Id (iid)
    let expectedIdx = i+1;

    // is there a gap in the GitLab issues?
    if (issues[i].iid != expectedIdx) {
      issues.splice(i, 0, placeholderItem);
      i++;
      console.log("Added placeholder issue for GitLab issue #" + expectedIdx)
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
      console.log("Creating: " + issue.iid + " - " + issue.title);
      try {

        // process asynchronous code in sequence
        await (() => {
          createIssueAndComments(settings.github.owner, settings.github.repo, milestoneData, issue).catch(x=>{});
        })(issue);

      } catch (err) {
        console.error("Could not create issue: " + issue.iid + " - " + issue.title);
        console.error(err);
      }
    } else {
      console.log("Already exists: " + issue.iid + " - " + issue.title);
      updateIssueState(ghIssue, issue);
    }
  };

}

// ----------------------------------------------------------------------------

/**
 * Get a list of all GitHub milestones currently in new repo
 */
async function getAllGHMilestones(owner, repo) {
  try {
    // get an array of GitHub milestones for the new repo
    let result = await github.issues.getMilestones({owner: owner, repo: repo, state: 'all'});

    // extract the milestone number and title and put into a new array
    let milestones = result.data.map(x => ({number: x.number, title: x.title}));

    return milestones;
  } catch (err) {
    console.error("Could not access all GitHub milestones");
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
    // get an array of GitHub labels for the new repo
    let result = await github.issues.getLabels({owner: owner, repo: repo, per_page: 100});

    // extract the label name and put into a new array
    let labels = result.data.map(x => x.name);

    return labels;
  } catch (err) {
    console.error("Could not access all GitHub label names");
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
  let allIssues = []
  let page = 1;
  const perPage = 100;

  while (true) {
    // get a paginated list of issues
    const issues = await github.issues.getForRepo({owner: owner, repo: repo, state: 'all', per_page: perPage, page: page });

    // if this page has zero issues then we are done!
    if (issues.data.length === 0)
      break;

    // join this list of issues with the master list
    allIssues = allIssues.concat(issues.data);

    // if there are strictly less issues on this page than the maximum number per page
    // then we can be sure that this is all the issues. No use querying again.
    if (issues.data.length < perPage)
      break;

    // query for the next page of issues next iteration
    page++;
  }

  return allIssues;
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
    body: bodyConverted
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
      props.assignees.push(settings.usermap[item.assignee.username]);
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
    props.labels = issue.labels;
  }

  //
  // Issue Attachments
  //

  // if the issue contains a url that contains "/uploads/", it is likely to
  // have an attachment. Therefore, add the "has attachment" label.
  if (props.body && props.body.indexOf('/uploads/') > -1) {
    props.labels.push('has attachment');
  }

  // create the GitHub issue from the GitLab issue
  return github.issues.create(props);
}

// ----------------------------------------------------------------------------

/**
 *
 */
async function createIssueComments(ghIssue, issue) {
  // retrieve any notes/comments associated with this issue
  try {
    let notes = await gitlab.IssueNotes.all(settings.gitlab.projectId, issue.iid);

    // if there are no notes, then there is nothing to do!
    if (notes.length == 0) return;

    // sort notes in ascending order of when they were created (by id)
    notes = notes.sort((a, b) => a.id - b.id);

    for (let note of notes) {

      if ((/Status changed to .*/.test(note.body) && !/Status changed to closed by commit.*/.test(note.body)) ||
          /changed milestone to .*/.test(note.body) ||
          /Milestone changed to .*/.test(note.body) ||
          /Reassigned to /.test(note.body) ||
          /added .* labels/.test(note.body) ||
          /Added ~.* label/.test(note.body) ||
          /mentioned in issue.*/.test(note.body)) {
        // Don't transfer when the state changed (this is a note in GitLab)
      } else {

        let bodyConverted = convertIssuesAndComments(note.body, note);

        // process asynchronous code in sequence
        await (async () => {
          await github.issues.createComment({
                      owner: settings.github.owner,
                      repo: settings.github.repo,
                      number: ghIssue.number,
                      body: bodyConverted
                    }).catch(x=>{});
        })(ghIssue, note);

      }

    };
  } catch (err) {
    console.error("Could not fetch notes for GitLab issue #" + issue.number);
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
    state: issue.state
  };

  // make the state update
  return github.issues.edit(props);
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
    state: (milestone.state === 'active') ? 'open' : 'closed'
  };

  if (milestone.due_date) {
    ghMilestone.due_on = milestone.due_date + 'T00:00:00Z';
  }

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
    color: label.color.substr(1) // remove leading "#" because gitlab returns it but github wants the color without it
  };

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

  if ((settings.usermap == null || Object.keys(settings.usermap).length == 0) &&
        (settings.projectmap == null || Object.keys(settings.projectmap).length == 0)) {
    return addMigrationLine(str, item);
  } else {
    // - Replace userids as defined in settings.usermap.
    //   They all start with '@' in the issues but we have them without in usermap
    // - Replace cross-project issue references. They are matched on org/project# so 'matched' ends with '#'
    //   They all have a '#' right after the project name in the issues but we have them without in projectmap
    let strWithMigLine = addMigrationLine(str, item);

    strWithMigLine.replace(userProjectRe, matched => {
      if (matched.startsWith('@')) {
        // this is a userid
        return '@' + settings.usermap[matched.substr(1)];
      } else if (matched.endsWith('#')) {
        // this is a cross-project issue reference
        return settings.projectmap[matched.substring(0, matched.length-1)] + '#';
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

  if (item == null || item.author == null || item.author.username == null || item.created_at == null) {
    return str;
  }

  var dateformatOptions = {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false
  }

  var formattedDate = new Date(item.created_at).toLocaleString('en-US', dateformatOptions);

  return "In GitLab by @" + item.author.username + " on " + formattedDate + "\n\n" + str;
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
  if (settings.projectmap != null && Object.keys(settings.projectmap).length > 0) {
    if (reString.length > 0) {
      reString += '|';
    }
    reString += Object.keys(settings.projectmap).join('#|') + '#';
  }

  return new RegExp(reString,'g');
}

// ----------------------------------------------------------------------------

/**
 * Print out a section heading to let the user know what is happening
 */
function inform(msg) {
  console.log("==================================");
  console.log(msg)
  console.log("==================================");
}