'use strict';

const Joi = require('joi');

const tag = Joi.object().keys({
    tagName: Joi.string(),
    defaultName: Joi.string()
}).requiredKeys('tagName');

module.exports = tag;