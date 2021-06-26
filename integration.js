const axios = require('axios');
const async = require('async');
const fs = require('fs');
const https = require('https');
const config = require('./config/config');
const errorToPojo = require('./utils/errorToPojo');

const URL = 'https://api.intsights.com/public/v2/iocs/ioc-by-value?';
const _configFieldIsValid = (field) => typeof field === 'string' && field.length > 0;
let Logger;

const startup = (logger) => {
  Logger = logger;
  const {
    request: { ca, cert, key, passphrase, rejectUnauthorized, proxy }
  } = config;

  const httpsAgent = new https.Agent({
    ...(_configFieldIsValid(ca) && { ca: fs.readFileSync(ca) }),
    ...(_configFieldIsValid(cert) && { cert: fs.readFileSync(cert) }),
    ...(_configFieldIsValid(key) && { key: fs.readFileSync(key) }),
    ...(_configFieldIsValid(passphrase) && { passphrase }),
    ...(typeof rejectUnauthorized === 'boolean' && { rejectUnauthorized })
  });

  axios.defaults = {
    agent: httpsAgent,
    ...(_configFieldIsValid(proxy) && { proxy: { host: proxy } })
  };
};

const doLookup = async (entities, options, cb) => {
  let lookupResults;

  try {
    lookupResults = await async.parallelLimit(
      entities.map((entity) => async () => lookupIoc(entity, options)),
      10
    );
  } catch (err) {
    let detailMsg = 'There was an unexpected error';

    if (err.response) {
      detailsMsg = `Received unexpected HTTP status ${err.response.status}`;
    } else if (err.request) {
      detailsMsg = `There was an HTTP err`;
    } else {
      detailMsg = err.message;
    }
    return cb(errorToPojo(detailMsg, err));
  }

  Logger.trace({ lookupResults });
  return cb(null, lookupResults);
};

const lookupIoc = async (entity, options) => {
  Logger.trace({ options });
  let results;

  results = await axios.get(URL, {
    auth: {
      username: options.username,
      password: options.password
    },
    params: {
      iocValue: entity.value
    }
  });

  const data = results.data;
  return (lookupResult = {
    entity,
    data:
      Object.keys(data).length > 0
        ? { summary: getSummary(data), details: data }
        : null
  });
};

const getSummary = (data) => {
  let tags = [];
  if (Object.keys(data).length > 0) {
    const totalResults = data.Sources.length;
    tags.push(`Sources: ${totalResults}`);

    if (data.Tags && data.Tags.length) {
      data.Tags.map((tag) => {
        tags.push(tag);
      });
    }
    if (data.SystemTags && data.SystemTags.length) {
      data.SystemTags.map((tag) => {
        tags.push(tag);
      });
    }
  }
  return tags;
};


function validateOption(errors, options, optionName, errMessage) {
  if (
    typeof options[optionName].value !== 'string' ||
    (typeof options[optionName].value === 'string' &&
      options[optionName].value.length === 0)
  ) {
    errors.push({
      key: optionName,
      message: errMessage
    });
  }
}

function validateOptions(options, callback) {
  let errors = [];

  validateOption(errors, options, 'username', 'You must provide a valid Username.');
  validateOption(errors, options, 'password', 'You must provide a valid Password.');

  callback(null, errors);
}

module.exports = {
  doLookup,
  startup,
  lookupIoc,
  validateOptions
};
