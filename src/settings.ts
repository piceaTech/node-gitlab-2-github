export default interface Settings {
  dryRun: boolean;
  exportUsers: boolean;
  gitlab: GitlabSettings;
  github: GithubSettings;
  usermap: {
    [key: string]: string;
  };
  projectmap: {
    [key: string]: string;
  };
  csvImport?:{
    projectMapCsv?: string;
    gitlabProjectIdColumn?: number;
    gitlabProjectPathColumn?: number;
    githubProjectPathColumn?: number;
    }
  conversion: {
    useLowerCaseLabels: boolean;
    addIssueInformation: boolean;
  };
  transfer: {
    description: boolean;
    milestones: boolean;
    labels: boolean;
    issues: boolean;
    mergeRequests: boolean;
    releases: boolean;
  };
  useIssueImportAPI: boolean;
  usePlaceholderMilestonesForMissingMilestones: boolean;
  usePlaceholderIssuesForMissingIssues: boolean;
  useReplacementIssuesForCreationFails: boolean;
  useIssuesForAllMergeRequests: boolean;
  filterByLabel?: string;
  trimOversizedLabelDescriptions: boolean;
  skipMergeRequestStates: string[];
  skipMatchingComments: string[];
  mergeRequests: {
    logFile: string;
    log: boolean;
  };
  commitMap?: {
    [key: string]: string;
  };
  s3?: S3Settings;
  commitMap: {
    [key: string]: string;
  };
}

export interface GithubSettings {
  baseUrl?: string;
  apiUrl?: string;
  owner: string;
  ownerIsOrg?: boolean;
  token: string;
  token_owner: string;
  repo: string;
  timeout?: number;
  username?: string; // when is this set???
  recreateRepo?: boolean;
}

export interface GitlabSettings {
  url?: string;
  token: string;
  projectId: number;
  listArchivedProjects?: boolean;
  sessionCookie: string;
}

export interface S3Settings {
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  region: string;
}
