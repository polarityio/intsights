// const axios = require('axios');
const gaxios = require('gaxios');
const async = require('async');
const fs = require('fs');
const https = require('https');
const config = require('./config/config');
const errorToPojo = require('./utils/errorToPojo');
const MAX_SUMMARY_TAGS = 6;

const _configFieldIsValid = (field) => typeof field === 'string' && field.length > 0;
let Logger;

function startup(logger) {
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

  if(_configFieldIsValid(proxy)){
    process.env.HTTP_PROXY = proxy;
    process.env.HTTPS_PROXY = proxy;
  }

  gaxios.instance.defaults = {
    agent: httpsAgent
  };
}

async function doLookup(entities, options, cb) {
  let lookupResults;

  try {
    lookupResults = await async.parallelLimit(
      entities.map((entity) => async () => lookupIoc(entity, options)),
      10
    );
  } catch (err) {
    Logger.error({ err }, 'Error looking up indicator');
    let detailMsg = 'There was an unexpected error';

    if (err.response) {
      detailMsg = `Received unexpected HTTP status ${err.response.status}`;
    } else if (err.request) {
      detailMsg = `There was an HTTP err`;
    } else {
      detailMsg = err.message;
    }
    return cb(errorToPojo(detailMsg, err));
  }

  Logger.trace({ lookupResults }, 'Lookup Results');
  return cb(null, lookupResults);
}

async function lookupIoc(entity, options) {
  let results;
  const url = 'https://api.intsights.com/public/v2/iocs/ioc-by-value';
  Logger.trace({ options, entity }, 'lookupIoc');

  results = await gaxios.request({
    url,
    headers: {
      Authorization:
        'Basic ' +
        Buffer.from(options.username + ':' + options.password).toString('base64')
    },
    params: {
      iocValue: entity.value
    }
  });

  const data = results.data;
  return {
    entity,
    data:
      Object.keys(data).length > 0 ? { summary: getSummary(data), details: data } : null
  };
}

function getSummary(data) {
  let tags = [];
  if (Object.keys(data).length > 0) {
    const totalResults = data.Sources.length;
    tags.push(`Sources: ${totalResults}`);

    if(data.Severity){
      tags.push(`Severity: ${data.Severity}`);
    }

    if (Array.isArray(data.Tags)) {
      data.Tags.forEach((tag) => {
        tags.push(tag);
      });
    }
    if (Array.isArray(data.SystemTags)) {
      data.SystemTags.forEach((tag) => {
        tags.push(tag);
      });
    }
  }
  if (tags.length > MAX_SUMMARY_TAGS) {
    let numTags = tags.length;
    tags = tags.slice(0, MAX_SUMMARY_TAGS);
    tags.push(`+${numTags - MAX_SUMMARY_TAGS} more tags`);
  }
  return tags;
}

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
  validateOptions
};
