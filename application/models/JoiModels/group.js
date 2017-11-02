'use strict';

const Joi = require('joi');

const getModel = Joi.object().keys({
    _id: Joi.number().integer(),
    user: Joi.number().integer(), 
    title: Joi.string(), 
    description: Joi.string().allow(['', null]),
    timestamp: Joi.string(), 
    lastUpdate: Joi.string(),
    decks: Joi.array().items(Joi.number().integer())
});

const newModel = Joi.object().keys({
    title: Joi.string(), 
    description: Joi.string().allow(['', null]),
    decks: Joi.array().items(Joi.number().integer())
}).requiredKeys('title', 'decks');

const onlyMetadata = Joi.object().keys({
    title: Joi.string(), 
    description: Joi.string().allow(['', null]),
}).requiredKeys('title');

const onlyDecks = Joi.object().keys({
    decks: Joi.array().items(Joi.number().integer())
}).requiredKeys('decks');

const updateOp = Joi.object().keys({
    op: Joi.string().valid('add', 'remove'), 
    deckId: Joi.number().integer()
}).requiredKeys('op', 'deckId');

module.exports = {
    getModel: getModel, 
    newModel: newModel, 
    onlyMetadata: onlyMetadata, 
    onlyDecks: onlyDecks, 
    updateOp: updateOp,
};