export default interface Settings {
  debug: boolean;
  gitlab: GitlabSettings;
  github: GithubSettings;
  usermap: {
    [key: string]: string;
  };
  projectmap: {
    [key: string]: string;
  };
  conversion: {
    useLowerCaseLabels: boolean;
  };
  transfer: {
    milestones: boolean;
    labels: boolean;
    issues: boolean;
    mergeRequests: boolean;
    transferOnlyOpen: boolean;
    createdAfter: string;
    updatedAfter: string;
  };
  usePlaceholderIssuesForMissingIssues: boolean;
  useReplacementIssuesForCreationFails: boolean;
  useIssuesForAllMergeRequests: boolean;
  filterByLabel: string | null;
  skipMatchingComments: string[];
  timeout: number,
  mergeRequests: {
    logFile: string;
    log: boolean;
  };
  s3?: S3Settings;
}

export interface GithubSettings {
  baseUrl?: string;
  owner: string;
  token: string;
  repo: string;
  timeout?: number;
  username?: string; // when is this set???
}

export interface GitlabSettings {
  url?: string;
  token: string;
  projectId: number;
}

export interface S3Settings {
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}
