module.exports = {
  "gitlab": {
    "url": "http://gitlab.mycompany.com/", // probably: https://gitlab.com
    "token": "{{gitlab private token}}",
    "projectId": null
  },
  "github": {
    // "baseUrl":"https://gitlab.mycompany.com:123/etc",
    "owner": "{{repository owner (user or organization)}}",
    "token": "{{token}}",
    "repo": "{{repo}}"
  },
  "usermap": {
    "username.gitlab.1": "username.github.1",
    "username.gitlab.2": "username.github.2"
  },
  "projectmap": {
    "gitlabgroup/projectname.1": "GitHubOrg/projectname.1",
    "gitlabgroup/projectname.2": "GitHubOrg/projectname.2"
  },
  "conversion": {
    "useLowerCaseLabels": true
  },
  "debug": false,
  "mergeRequests": {
    "logFile": "./merge-requests.json",
    "log": false
  }
}
