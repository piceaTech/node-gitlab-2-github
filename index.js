var GitHubApi = require("github");
var Gitlab = require('gitlab');
var async = require('async');

var settings = require('./settings.json');
console.log(settings);

var gitlab = Gitlab({
  url: settings.gitlab.url,
  token: settings.gitlab.token
});

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
    host: "api.github.com",
    pathPrefix: "",
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

  gitlab.projects.milestones.list(settings.gitlab.projectID, function(data) {
    console.log('Amount of gitlab milestones', data.length);
    data = data.sort(function(a, b) {
      return a.id - b.id;
    });
    github.issues.getAllMilestones({
      user: settings.github.username,
      repo: settings.github.repo
    }, function(err, milestoneDataOpen) {
      github.issues.getAllMilestones({
        user: settings.github.username,
        repo: settings.github.repo,
        state: 'closed'
      }, function(err, milestoneDataClosed) {
        milestoneData = milestoneDataClosed.concat(milestoneDataOpen).map(function(item) {
          return {
            number: item.number,
            title: item.title
          };
        });
        milestoneDataMapped = milestoneData.map(function(item) {
          return item.title;
        });

        console.log('\n\n\n\n\n\n\n>>>>');
        console.log(milestoneDataMapped);
        console.log('\n\n\n\n\n\n\n');
        console.log(milestoneDataClosed[0]);

        console.log('\n\n\n\n\n\n\n');
        async.each(data, function(item, cb) {
          if (milestoneDataMapped.indexOf(item.title) < 0) {
            console.log('Creating new Milestone', item.title);
            createMilestone(item, function(err, createMilestoneData) {
              console.log(createMilestoneData);
              return cb(err);
            });
          } else {
            return cb(err);
          }
        }, function(err) {
          if (err) return console.log(err);
          // all milestones are created
          createAllIssuesAndComments(milestoneData, function(err, data) {
            console.log('\n\n\n\nFinished creating all issues and Comments\n\n\n\n')
            console.log(err, data)
          });
        }); // async
      }); // closed Issues
    }); // opend issues
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
    console.log('length Issue GitLab:', issueData.length)


    getAllGHIssues(function(err, ghIssues) {
      ghIssuesMapped = ghIssues.map(function(item) {
        return item.title;
      });
      console.log('length Issue GitLab:', ghIssues.length)


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

function getAllGHIssues(callback) {
  var lastItem = null;
  var curPage = 1;
  var allGhIssues = [];
  async.whilst(function() {
    return hasNext(lastItem)
  }, function(cb) {
    github.issues.repoIssues({
      user: settings.github.username,
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
  var props = {
    user: settings.github.username,
    repo: settings.github.repo,
    title: item.title.trim(),
    body: item.description
  };
  if (item.assignee && item.assignee.username == settings.github.username) { // TODO create Username mapping
    props.assignee = item.assignee.username;
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
  console.log('props', props);
  github.issues.create(props, function(err, newIssueData) {
    if (!err) {
      createAllIssueComments(settings.gitlab.projectID, item.id, newIssueData, function(err, issueData) {
        makeCorrectState(newIssueData, item, callback)
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
    user: settings.github.username,
    repo: settings.github.repo,
    number: ghIssueData.number,
    state: 'closed',
  };
  if (item.milestone) {
    var title = findMileStoneforTitle(milestoneData, item.milestone.title)
    if (title !== null) {
      props.milestone = title;
    }
  }

  console.log('makeCorrectState', ghIssueData.number, item.state, props.milestone);
  console.log('makeCorrectState props', props);
  github.issues.edit(props, callback);
}

function createAllIssueComments(projectID, issueID, newIssueData, callback) {
  // get all comments add them to the comment
  gitlab.projects.issues.notes.all(projectID, issueID, function(data) {
    if (data.length) {
      data = data.sort(function(a, b) {
        return a.id - b.id;
      });
      async.eachSeries(data, function(item, cb) {
        if ((/Status changed to .*/.test(item.body) && !/Status changed to closed by commit.*/.test(item.body)) || /Milestone changed to.*/.test(item.body) || /Reassigned to /.test(item.body)) {
          // don't transport when the state changed (is a note in gitlab)
          return cb();
        } else {
          github.issues.createComment({
            user: settings.github.username,
            repo: settings.github.repo,
            number: newIssueData.number,
            body: item.body
          }, cb);
        }
      }, callback)
    } else {
      callback();
    }
  });
}


function createMilestone(data, cb) {
  github.issues.createMilestone({
    user: settings.github.username,
    repo: settings.github.repo,
    title: data.title,
    description: data.description,
    state: (data.state === 'active') ? 'open' : 'closed',
    due_on: data.due_date + 'T00:00:00Z'
  }, cb);
}
