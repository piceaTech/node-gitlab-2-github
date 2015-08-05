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
      console.log(projects[i].id, projects[i].description, projects[i].name);
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
    debug: true,
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





  // TODO check whether user has created all milestones on github

  gitlab.projects.milestones.list(settings.gitlab.projectID, function(data) {
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
        milestoneData = milestoneDataClosed.concat(milestoneDataOpen);
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
              cb(err);
            });
          } else {
            cb(err);
          }
        }, function(err) {
          if (err) return console.log(err);
          // all milestones are created
          createAllIssuesAndComments(milestoneData);


        }); // async

      }); // closed Issues
    }); // opend issues
  }); // gitlab list milestones
}


function createAllIssuesAndComments(milestoneData) {
  // select all issues and comments from this project
  gitlab.projects.issues.list(settings.gitlab.projectID, function(issueData) {
    // look whether issue is already created
    console.log('length:', issueData.length)

    // console.log('~', issueData);
    async.eachSeries(issueData, function(item, cb) {
      console.log(settings.github.username);
      var props = {
        user: settings.github.username,
        repo: settings.github.repo,
        title: item.title,
        body: item.description
      };
      if(item.assignee && item.assignee.username == settings.github.username){
        props.assignee = item.assignee.username;
      }
      if (item.milestone) {
        var title = findMileStoneforTitle(milestoneData, item.milestone.title)
        if (title !== null) {
          props.milestone = title;
        } else {
          // don't import issues where milestone got deleted
          return cb();
        }
      }
      console.log('props:', props);
      github.issues.create({
        props
      }, function(err, data) {
        console.log('errData' , err, data);
        if (!err) {
          createAllIssueComments(settings.gitlab.projectID, item.id, data, cb);
        } else {
          cb(err);
        }
      });
    }, function(err) {
      console.log('error with issueData:', err);
    });

  })
}

function findMileStoneforTitle(milestoneData, title) {
  for (var i = milestoneData.length - 1; i >= 0; i--) {
    if (milestoneData[i].title == title) {
      console.log(milestoneData[i].number);
      return milestoneData[i].number;
    }
  }
  return null;
}

function createAllIssueComments(projectID, issueID, newIssueData, cb) {
  // get all comments add them to the comment
  gitlab.issues.notes.all(projectID, issueID, function(data) {
    if (data.length) {
      for (var i = data.length - 1; i >= 0; i--) {

        github.issues.createComment({
          user: settings.github.username,
          repo: settings.github.repo,
          number: newIssueData.number,
          body: data[i].body
        }, cb)
      }
    }
  })
}


function createMilestone(data, cb) {
  github.issues.createMilestone({
    username: settings.github.username,
    repo: settings.github.repo,
    title: data.title,
    description: data.description,
    state: (data.state === 'active') ? 'open' : 'closed',
    due_on: data.due_date + 'T00:00:00Z'
  }, cb);
}
