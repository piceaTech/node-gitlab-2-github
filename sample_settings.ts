import Settings from './src/settings';

export default {
  gitlab: {
    // url: 'https://gitlab.mycompany.com',
    token: '{{gitlab private token}}',
    projectId: null,
  },
  github: {
    // baseUrl: 'https://gitlab.mycompany.com:123/etc',
    owner: '{{repository owner (user or organization)}}',
    token: '{{token}}',
    repo: '{{repo}}',
  },
  s3: {
    accessKeyId: '{{accessKeyId}}',
    secretAccessKey: '{{secretAccessKey}}',
    bucket: 'my-gitlab-bucket',
  },
  usermap: {
    'username.gitlab.1': 'username.github.1',
    'username.gitlab.2': 'username.github.2',
  },
  projectmap: {
    'gitlabgroup/projectname.1': 'GitHubOrg/projectname.1',
    'gitlabgroup/projectname.2': 'GitHubOrg/projectname.2',
  },
  conversion: {
    useLowerCaseLabels: true,
  },
  transfer: {
    milestones: true,
    labels: true,
    issues: true,
    mergeRequests: true,
    transferOnlyOpen: false,
    createdAfter: null,
    updatedAfter: '2000-01-01T00:00:00Z'
  },
  debug: false,
  usePlaceholderIssuesForMissingIssues: true,
  useReplacementIssuesForCreationFails: true,
  useIssuesForAllMergeRequests: false,
  filterByLabel: null,
  skipMatchingComments: [],
  timeout: 30000,
  mergeRequests: {
    logFile: './merge-requests.json',
    log: false,
  },
} as Settings;
