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
  usermap: {
  },
  projectmap: {
  },
  conversion: {
    useLowerCaseLabels: true,
  },
  debug: false,
  usePlaceholderIssuesForMissingIssues: true,
  useReplacementIssuesForCreationFails: true,
  useIssuesForAllMergeRequests: false,
  skipMatchingComments: [],
  mergeRequests: {
    logFile: './merge-requests.json',
    log: false,
  },
} as Settings;
