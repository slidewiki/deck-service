'use strict';

const co = require('../common');

module.exports = {
    'file': {
        uri: (!co.isEmpty(process.env.SERVICE_URL_FILE)) ? process.env.SERVICE_URL_FILE : 'http://fileservice',
        disabled: (process.env.NODE_ENV === 'test'),
    },
    'user': {
        uri: (!co.isEmpty(process.env.SERVICE_URL_USER)) ? process.env.SERVICE_URL_USER : 'http://userservice',
    },
    'tag': {
        uri: (!co.isEmpty(process.env.SERVICE_URL_TAG)) ? process.env.SERVICE_URL_TAG : 'http://tagservice',
        disabled: (process.env.NODE_ENV === 'test'),
    },
    'translation' :{
        uri: (!co.isEmpty(process.env.SERVICE_URL_TRANSLATION)) ? process.env.SERVICE_URL_TRANSLATION : 'http://translationservice',
    },
};
