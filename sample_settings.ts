import Settings from './src/settings';

export default {
  gitlab: {
    // url: 'https://gitlab.mycompany.com',
    token: '{{gitlab private token}}',
    projectId: 0,
    listArchivedProjects: true,
    sessionCookie: "",
  },
  github: {
    // baseUrl: 'https://github.mycompany.com:123/etc',
    // apiUrl: 'https://api.github.mycompany.com',
    owner: '{{repository owner (user or organization)}}',
    ownerIsOrg: false,
    repo: '{{repo}}',
    tokens: [
      {
        value: '{{token of first github user}}',
        owner: '{{github user 1}}',
      },
      {
        value: '{{token of second github user}}',
        owner: '{{github user 2}}',
      },
    ],
    recreateRepo: false,
  },
  s3: {
    accessKeyId: '{{accessKeyId}}',
    secretAccessKey: '{{secretAccessKey}}',
    bucket: 'my-gitlab-bucket',
    region: null,
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
    description: true,
    milestones: true,
    labels: true,
    issues: true,
    mergeRequests: true,
    releases: true,
  },
  dryRun: false,
  useIssueImportAPI: true,
  usePlaceholderMilestonesForMissingMilestones: true,
  usePlaceholderIssuesForMissingIssues: true,
  useReplacementIssuesForCreationFails: true,
  useIssuesForAllMergeRequests: false,
  filterByLabel: undefined,
  trimOversizedLabelDescriptions: false,
  skipMergeRequestStates: [],
  skipMatchingComments: [],
  mergeRequests: {
    logFile: './merge-requests.json',
    log: false,
  },
} as Settings;
