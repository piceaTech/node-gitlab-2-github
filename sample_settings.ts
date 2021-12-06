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
    useS3: false,
    keepLocal: true,
    // overrideURL: 'github.example.com/org/repo/raw/master',
    overrideURL: '{{overrideURL}}',
    // overrideSuffix if needed
    overrideSuffix: '{{overrideSuffix}}',
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
  },
  debug: false,
  clearIssueAssignment: false,
  usePlaceholderIssuesForMissingIssues: true,
  useReplacementIssuesForCreationFails: true,
  useIssuesForAllMergeRequests: false,
  filterByLabel: null,
  skipMatchingComments: [],
  mergeRequests: {
    logFile: './merge-requests.json',
    log: false,
  },
} as Settings;
