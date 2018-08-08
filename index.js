const GitHubApi = require('@octokit/rest')
const Gitlab = require('gitlab').default
const async = require('async');

try {
  var settings = require('./settings.js');
} catch(e) {
  if (e.code === 'MODULE_NOT_FOUND') {
    console.log('\n\nPlease copy the sample_settings.json to settings.json.');
  } else {
    console.log(e);
  }
  
  process.exit(1);
}

// Ensure that the GitLab URL and token has been set in settings.json
if (!settings.gitlab.url || settings.gitlab.url === "http://gitlab.mycompany.com/") {
  console.log('\n\nYou have to enter your gitlab url in the settings.json file.');
  process.exit(1);
}
if (!settings.gitlab.token || settings.gitlab.token === "{{gitlab private token}}") {
  console.log('\n\nYou have to enter your gitlab private token in the settings.json file.');
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

// If no project id is given in settings.json, just return
// all of the projects that this user is associated with.
if (settings.gitlab.projectID === null) {
  listProjects();
} else {
  // user has choosen a project
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
    console.log('Select which project ID should be transported to github. Edit the settings.json accordingly. (gitlab.projectID)');
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
  transferLabels(settings.gitlab.projectId, settings.conversion.useLowerCaseLabels);

  // create a hasAttachment label for manual attachment migration
  const hasAttachmentLabel = {name: 'hasAttachment', color: '#fbca04'};
  // createLabel(hasAttachmentLabel, function(err, createLabelData) {
  //   console.log(createLabelData);
  // });

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

  // if a GitLab milestone does not exist in GitHub repo, create it.
  for (let milestone of milestones) {
      if (!ghMilestones.find(m => m.title === milestone.title)) {
        console.log("Creating " + milestone.title);
        try {

          // process asynchronous code in sequence
          await (() => {
            createMilestone(settings.github.owner, settings.github.repo, milestone)
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
async function transferLabels(projectId, useLowerCase = true) {
  // Get a list of all labels associated with this project
  let labels = await gitlab.Labels.all(projectId);

  // get a list of the current label names in the new GitHub repo (likely to be just the defaults)
  let ghLabels = await getAllGHLabelNames(settings.github.owner, settings.github.repo);

  // if a GitLab label does not exist in GitHub repo, create it.
  labels.forEach(function(label) {

    // GitHub prefers lowercase label names
    if (useLowerCase) {
      label.name = label.name.toLowerCase()
    }

    if (!ghLabels.find(l => l === label.name)) {
      console.log("Creating " + label.name);
    } else {
      console.log("Already exists: " + label.name);
    }
  });
}

// ----------------------------------------------------------------------------

function migrate1() {

  github.authenticate({
    type: "basic",
    username: settings.github.username,
    password: settings.github.token
  });

  gitlab.ProjectMilestones.all(settings.gitlab.projectID).then(function(data) {
    console.log('Amount of gitlab milestones', data.length);
    data = data.sort(function(a, b) { return a.id - b.id; });
    getAllGHMilestones(function(milestoneDataA, milestoneDataMappedA) {
      // for now use globals
      milestoneData = milestoneDataA;
      milestoneDataMapped = milestoneDataMappedA;

      console.log('\n\n\n\n\n\n\nMilestones>>>>');
      console.log(milestoneDataMapped);
      console.log('\n\n\n\n\n\n\n');

      async.each(data, function(item, cb) {
        if (milestoneDataMapped.indexOf(item.title) < 0) {
          console.log('Creating new Milestone', item.title);
          createMilestone(item, function(err, createMilestoneData) {
            console.log(createMilestoneData);
            return cb(err);
          });
        } else {
          return cb(null);
        }
      }, function(err) {
        if (err) return console.log(err);
        // all milestones are created
        getAllGHMilestones(function(milestoneDataA, milestoneDataMappedA) {
          // create labels
          gitlab.Labels.all(settings.gitlab.projectID).then(function(glLabels) {
            getAllGHLabelNames(function(ghlabelNames) {
              async.each(glLabels, function(glLabel, cb) {
                if (ghlabelNames.indexOf(glLabel.name) < 0) {
                  console.log('Creating new Label', glLabel.name);
                  createLabel(glLabel, function(err, createLabelData) {
                    console.log(createLabelData);
                    return cb(err);
                  });
                } else {
                  return cb(null);
                }
              }, function(err) {
                // if (err) return console.log(err);
                // all labels are created, create a hasAttachment label for manual attachment migration
                var glLabel = {
                  name: 'hasAttachment',
                  color: '#fbca04'
                }
                createLabel(glLabel, function(err, createLabelData) {
                  console.log(createLabelData);
                });

                // for now use globals
                milestoneData = milestoneDataA;
                milestoneDataMapped = milestoneDataMappedA;

                createAllIssuesAndComments(milestoneData, function(err, data) {
                  console.log('\n\n\n\nFinished creating all issues and Comments\n\n\n\n');
                  console.log('err and data:', err, data);
                });
              }); //async
            }); // getAllGHLabelNames
          }).catch(function(err){
            console.log('An Error occured while loading all labels:');
            console.log(err);
          }); // gitlab list labels
        }); // getAllGHMilestones
      }); // async
    })
  }).catch(function(err){
    console.log('An Error occured while loading all milestones:');
    console.log(err);
  }); // gitlab list milestones
}


function createAllIssuesAndComments(milestoneData, callback) {
  // select all issues and comments from this project
  gitlab.Issues.all({projectId: settings.gitlab.projectID}).then(function(issueData) {
    // TODO return all issues via pagination
    // look whether issue is already created
    issueData = issueData.sort(function(a, b) {
      return a.id - b.id;
    });
    console.log('length Issue GitLab:', issueData.length);

    // loop through all issues and add placeholder issues if there are gaps
    // this is to ensure issue id's are the same in gitlab and GitHub
    var placeHolderItem = {
      title: 'Place holder issue for issue which does not exist probably deleted in Gitlab',
      description: 'This is to ensure the issue ids in Gitlab and GitHub are the same',
      state: 'closed'
    }
    for (var iIssue = 0; iIssue < issueData.length; iIssue++) {
      if (issueData[iIssue].iid != iIssue + 1) {
        issueData.splice(iIssue, 0, placeHolderItem);
        iIssue++;
        console.log('Added placeholder item for missing issue with id:', iIssue + 1);
      }
    }

    getAllGHIssues(function(err, ghIssues) {
      if(err){
        console.log(err);
        console.log('getAllGHIssues');
        console.log('FAIL!');
        process.exit(1);
      }
      ghIssuesMapped = ghIssues.map(function(item) {
        return item.title;
      });
      console.log('length Issue GitHub:', ghIssues.length);

      async.eachSeries(issueData, function(item, cb) {
        if (item.milestone) {
          var title = findMileStoneforTitle(milestoneData, item.milestone.title)
          if (title !== null) {
            console.log('title', title);
          }
        }
        if (ghIssuesMapped.indexOf(item.title.trim()) < 0) {
          console.log('Creating new Issue', item.title.trim());
          createIssueAndComments(item, function(err, createIssueData) {
            console.log(createIssueData);
            return cb(err);
          });
        } else {
          var ghIssue = ghIssues.filter(function(element, index, array) {
            return element.title == item.title.trim();
          });
          return makeCorrectState(ghIssue[0], item, cb);
        }
      }, function(err) {
        if (err) console.log('error with issueData:', err);
        callback(err);
      }); // each series
    }); // getAllGHIssues
  }).catch(function(err){
    console.log('An Error occured while fetching all issues:');
    console.log(err);
  }); // gitlab project Issues
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

function getAllGHIssues(callback) {
  var lastItem = null;
  var curPage = 1;
  var allGhIssues = [];
  async.whilst(function() {
    return hasNext(lastItem)
  }, function(cb) {
    github.issues.getForRepo({
      owner: settings.github.owner,
      repo: settings.github.repo,
      state: 'all',
      per_page: 100,
      page: curPage
    }, function(err, ghIssues) {
      if(err){
        console.log(err);
        console.log('getAllGHIssues');
        console.log('FAIL!');
        process.exit(1);
      }
      console.log('got page', curPage, 'with', ghIssues.data.length, 'entries');
      console.log('\n\n\n');
      console.log('ghIssues.meta', ghIssues.meta);

      curPage++;
      lastItem = ghIssues;
      var l = ghIssues.data.length;
      for (var i = 0; i < l; i++) {
        allGhIssues[allGhIssues.length] = ghIssues.data[i];
      }
      cb(err);
    }); // gh repo Issues
  }, function(err) {
    console.log('issue Count on GH:', allGhIssues.length)
    callback(err, allGhIssues);
  }); // async whilst
}

function hasNext(item) {
  if (item === null) {
    return true;
  } else if (item.meta.link == undefined || item.meta.link.indexOf('next') < 0) {
    return false
  } else {
    return true
  }

}


function findMileStoneforTitle(milestoneData, title) {
  for (var i = milestoneData.length - 1; i >= 0; i--) {
    if (milestoneData[i].title == title) {
      console.log('findMileStoneforTitle', milestoneData[i].number);
      return milestoneData[i].number;
    }
  }
  return null;
}

function createIssueAndComments(item, callback) {
  var props = null;
  convertIssuesAndComments(item.description, item, function(bodyConverted) {
    props = {
      owner: settings.github.owner,
      repo: settings.github.repo,
      title: item.title.trim(),
      body: bodyConverted
    };
  });
  if (item.assignee) {
    if (item.assignee.username == settings.github.username) {
      props.assignee = item.assignee.username;
    } else if (settings.usermap && settings.usermap[item.assignee.username]) {
      // get github username name from config
      props.assignee = settings.usermap[item.assignee.username];
    }
  }
  if (item.milestone) {
    var title = findMileStoneforTitle(milestoneData, item.milestone.title)
    if (title !== null) {
      props.milestone = title;
    } else {

      // TODO also import issues where milestone got deleted
      // return callback();
    }
  }
  if (item.labels) {
    props.labels = item.labels;

    // add hasAttachment label if body contains an attachment for manual migration
    if (props.body && props.body.indexOf('/uploads/') > -1) {
      props.labels.push('hasAttachment');
    }
  }
  console.log('props', props);
  github.issues.create(props, function(err, newIssueData) {
    if (!err) {
      createAllIssueComments(settings.gitlab.projectID, item.iid, newIssueData.data, function(err, issueData) {
        makeCorrectState(newIssueData.data, item, callback);
      });
    } else {
      console.log('errData', err, newIssueData);
      return callback(err);
    }
  });
}


function makeCorrectState(ghIssueData, item, callback) {
  if (item.state != 'closed' || ghIssueData.state == 'closed') {
    // standard is open so we don't have to update
    return callback(null, ghIssueData);
  }

  // TODO get props
  var props = {
    owner: settings.github.owner,
    repo: settings.github.repo,
    number: ghIssueData.number,
    state: 'closed',
  };
  if (item.milestone) {
    var title = findMileStoneforTitle(milestoneData, item.milestone.title);
    if (title !== null) {
      props.milestone = title;
    }
  }

  console.log('makeCorrectState', ghIssueData.number, item.state, props.milestone);
  console.log('makeCorrectState props', props);
  github.issues.edit(props, callback);
}

function createAllIssueComments(projectID, issueID, newIssueData, callback) {
  if (issueID == null) {
    return callback();
  }
  // get all comments add them to the comment
  console.log(`fetching all notes for issue ${issueID}`);
  gitlab.IssueNotes.all(projectID, issueID).then(function(data) {
    if (data.length) {
      data = data.sort(function(a, b) {
        return a.id - b.id;
      });
      async.eachSeries(data, function(item, cb) {
        if ((/Status changed to .*/.test(item.body) && !/Status changed to closed by commit.*/.test(item.body)) ||
            /changed milestone to .*/.test(item.body) ||
            /Reassigned to /.test(item.body) ||
            /added .* labels/.test(item.body) ||
            /mentioned in issue.*/.test(item.body)) {
          // don't transport when the state changed (is a note in gitlab)
          return cb();
        } else {
          convertIssuesAndComments(item.body, item, function(bodyConverted) {
            github.issues.createComment({
              owner: settings.github.owner,
              repo: settings.github.repo,
              number: newIssueData.number,
              body: bodyConverted
            }, cb);
        });
        }
      }, callback)
    } else {
      callback();
    }
  }).catch(function(err){
    console.log(`An Error occured while fetching all notes for issue ${issueID}:`);
    console.log(err);
  });
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

function createLabel(glLabel, cb) {
  github.issues.createLabel({
    owner: settings.github.owner,
    repo: settings.github.repo,
    name: glLabel.name,
    color: glLabel.color.substr(1) // remove leading "#" because gitlab returns it but github wants the color without it
  }, cb);
}

/**
 * Converts issue body and issue comments from gitlab to github. That means:
 * - Add a line at the beginning indicating which original user created the
 *   issue or the comment and when - because the github API creates everything
 *   as the API user
 * - Change username from gitlab to github in "mentions" (@username)
 */
function convertIssuesAndComments(str, item, cb){
  if ( (settings.usermap == null || Object.keys(settings.usermap).length == 0) &&
        (settings.projectmap == null || Object.keys(settings.projectmap).length == 0)) {
    addMigrationLine(str, item, cb);
  } else {
    // - Replace userids as defined in settings.usermap.
    //   They all start with '@' in the issues but we have them without in usermap
    // - Replace cross-project issue references. They are matched on org/project# so 'matched' ends with '#'
    //   They all have a '#' right after the project name in the issues but we have them without in projectmap
    addMigrationLine(str, item, function(strWithMigLine) {
      cb(strWithMigLine.replace(userProjectRe, function(matched) {
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
      }));
    });
  }
}

function addMigrationLine(str, item, cb) {

  if (item == null || item.author == null || item.author.username == null || item.created_at == null) {
    return cb(str);
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

  return cb("In gitlab by @" +item.author.username+ " on " +formattedDate+ "\n\n" +str);
}

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
