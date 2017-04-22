var GitHubApi = require("github");
var Gitlab = require('gitlab');
var async = require('async');

try{
  var settings = require('./settings.json');  
}
catch(e){
  if(e.code === 'MODULE_NOT_FOUND'){
    console.log('\n\nPlease copy the sample_settings.json to settings.json.');
  }
  else{

  }
}

console.log(settings);
console.log('\n\n\n');


if(settings.gitlab.url === "http://gitlab.mycompany.com/"){
  console.log('\n\nYou have to enter your gitlab url in the settings.json file.');
  process.exit(1);
}
if(settings.gitlab.toke === "{{gitlab private token}}"){
  console.log('\n\nYou have to enter your gitlab private token in the settings.json file.');
  process.exit(1);
}

var gitlab = Gitlab({
  url: settings.gitlab.url,
  token: settings.gitlab.token
});

var userProjectRe = generateUserProjectRe();

if (settings.gitlab.projectID === null) {
  gitlab.projects.all(function(projects) {
    projects = projects.sort(function(a, b) {
      return a.id - b.id;
    });
    for (var i = 0; i < projects.length; i++) {
      console.log('projects:', projects[i].id, projects[i].description, projects[i].name);
    }
    console.log('\n\n');
    console.log('Select which project ID should be transported to github. Edit the settings.json accordingly. (gitlab.projectID)');
    console.log('\n\n');
  });
} else {
  // user has choosen a project


  var github = new GitHubApi({
    // required
    version: "3.0.0",
    // optional
    //debug: true,
    protocol: "https",
    host: settings.github.url,
    pathPrefix: settings.github.pathPrefix,
    timeout: 5000,
    headers: {
      "user-agent": "node-gitlab-2-github" // GitHub is happy with a unique user agent
    }
  });
  github.authenticate({
    type: "basic",
    username: settings.github.username,
    password: settings.github.password
  });
  
  gitlab.projects.milestones.all(settings.gitlab.projectID, function(data) {
    console.log('Amount of gitlab milestones', data.length);
    data = data.sort(function(a, b) {
      return a.id - b.id;
    });
    getAllGHMilestones(function(milestoneDataA, milestoneDataMappedA) {
      // for now use globals
      milestoneData = milestoneDataA;
      milestoneDataMapped = milestoneDataMappedA;

      console.log('\n\n\n\n\n\n\n>>>>');
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
          gitlab.projects.labels.all(settings.gitlab.projectID, null, function(glLabels) {
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
                if (err) return console.log(err);
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
                  console.log(err, data);
                });
              }); //async
            }); // getAllGHLabelNames
          }); // gitlab list labels
        }); // getAllGHMilestones
      }); // async
    })
  }); // gitlab list milestones
}


function createAllIssuesAndComments(milestoneData, callback) {
  // select all issues and comments from this project
  gitlab.projects.issues.list(settings.gitlab.projectID, function(issueData) {
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
  }); // gitlab project Issues
}

function getAllGHMilestones(callback) {
  github.issues.getAllMilestones({
    user: settings.github.owner,
    repo: settings.github.repo
  }, function(err, milestoneDataOpen) {
    if(err){
        console.log(err);
        console.log('getAllGHMilestones1');
        console.log('FAIL!');
        process.exit(1);
      }
    github.issues.getAllMilestones({
      user: settings.github.owner,
      repo: settings.github.repo,
      state: 'closed'
    }, function(err, milestoneDataClosed) {
      if(err){
        console.log(err);
        console.log('getAllGHMilestones2');
        console.log('FAIL!');
        process.exit(1);
      }
      milestoneData = milestoneDataClosed.concat(milestoneDataOpen).map(function(item) {
        return {
          number: item.number,
          title: item.title
        };
      });
      milestoneDataMapped = milestoneData.map(function(item) {
        return item.title;
      });
      return callback(milestoneData, milestoneDataMapped);

    }); // openMilestones
  }); //closedMilestones

}

function getAllGHIssues(callback) {
  var lastItem = null;
  var curPage = 1;
  var allGhIssues = [];
  async.whilst(function() {
    return hasNext(lastItem)
  }, function(cb) {
    github.issues.repoIssues({
      user: settings.github.owner,
      repo: settings.github.repo,
      state: 'all',
      per_page: 100,
      page: curPage
    }, function(err, ghIssues) {
      console.log('got page', curPage, 'with', ghIssues.length, 'entries');
      console.log('\n\n\n');
      console.log('ghIssues.meta', ghIssues.meta);

      curPage++;
      lastItem = ghIssues;
      var l = ghIssues.length;
      for (var i = 0; i < l; i++) {
        allGhIssues[allGhIssues.length] = ghIssues[i];
      }
      cb(err);
    }); // gh repo Issues
  }, function(err) {
    console.log('issue Count on GH:', allGhIssues.length)
    callback(err, allGhIssues);
  }); // async whilst
}

function getAllGHLabelNames(callback) {
  github.issues.getLabels({
    user: settings.github.owner,
    repo: settings.github.repo,
    per_page: 100
  }, function(err, labelData) {
    if (err){
        console.log(err);
        console.log('getAllGHLabelNames');
        console.log('FAIL!');
        process.exit(1);
    }
    var labelNames = labelData.map(function(item) {
      return item.name;
    });

    return callback(labelNames);
  });

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
      user: settings.github.owner,
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
      createAllIssueComments(settings.gitlab.projectID, item.id, newIssueData, function(err, issueData) {
        makeCorrectState(newIssueData, item, callback);
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
    user: settings.github.owner,
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
  gitlab.projects.issues.notes.all(projectID, issueID, function(data) {
    if (data.length) {
      data = data.sort(function(a, b) {
        return a.id - b.id;
      });
      async.eachSeries(data, function(item, cb) {
        if ((/Status changed to .*/.test(item.body) && !/Status changed to closed by commit.*/.test(item.body)) || 
            /Milestone changed to.*/.test(item.body) || 
            /Reassigned to /.test(item.body) || 
            /Added .* label/.test(item.body)) {
          // don't transport when the state changed (is a note in gitlab)
          return cb();
        } else {
          convertIssuesAndComments(item.body, item, function(bodyConverted) {
            github.issues.createComment({
              user: settings.github.owner,
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
  });
}


function createMilestone(data, cb) {
  github.issues.createMilestone({
    user: settings.github.owner,
    repo: settings.github.repo,
    title: data.title,
    description: data.description,
    state: (data.state === 'active') ? 'open' : 'closed',
    due_on: data.due_date + 'T00:00:00Z'
  }, cb);
}

function createLabel(glLabel, cb) {
  github.issues.createLabel({
    user: settings.github.owner,
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
