'use strict';

const Joi = require('joi');

const tag = Joi.object().keys({
    tagType: Joi.string().valid('topic'),
    tagName: Joi.string(),
    defaultName: Joi.string(),
}).requiredKeys('tagName');

module.exports = tag;
