import * as settings from './settings';

const sleep = milliseconds => {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
};

/**
 * Generate regular expression which finds userid and cross-project issue references
 * from usermap and projectmap
 */
const generateUserProjectRegex = () => {
  let reString = '';
  if (settings.usermap !== null && Object.keys(settings.usermap).length > 0) {
    reString = '@' + Object.keys(settings.usermap).join('|@');
  }
  if (
    settings.projectmap !== null &&
    Object.keys(settings.projectmap).length > 0
  ) {
    if (reString.length > 0) {
      reString += '|';
    }
    reString += Object.keys(settings.projectmap).join('#|') + '#';
  }

  return new RegExp(reString, 'g');
};

// ----------------------------------------------------------------------------

module.exports = { sleep, generateUserProjectRegex };
