'use strict';

const Joi = require('joi');

const getModel = Joi.object().keys({
    _id: Joi.number().integer(),
    user: Joi.number().integer(), 
    title: Joi.string(), 
    description: Joi.string().allow(['', null]),
    timestamp: Joi.string(), 
    lastUpdate: Joi.string(),
    userGroup: Joi.number().integer(),
    decks: Joi.array().items(Joi.number().integer())
});

const newModel = Joi.object().keys({
    title: Joi.string(), 
    description: Joi.string().allow(['', null]),
    userGroup: Joi.number().integer(),
    decks: Joi.array().items(Joi.string())
}).requiredKeys('title', 'decks');

const onlyMetadata = Joi.object().keys({
    title: Joi.string(), 
    description: Joi.string().allow(['', null]),
    userGroup: Joi.number().integer(),
}).requiredKeys('title', 'description');

const onlyDecks = Joi.array().items(Joi.string());

const updateOp = Joi.object().keys({
    op: Joi.string().valid('add', 'remove'), 
    deckId: Joi.string()
}).requiredKeys('op', 'deckId');

module.exports = {
    getModel: getModel, 
    newModel: newModel, 
    onlyMetadata: onlyMetadata, 
    onlyDecks: onlyDecks, 
    updateOp: updateOp,
};