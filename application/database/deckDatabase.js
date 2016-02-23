'use strict';

const helper = require('./helper');

module.exports = {
  get: function(identifier) {
    return helper.connectToDatabase()
      .then((db) => db.collection('decks'))
      .then((col) => col.findOne({
        _id: identifier
      }));
  },

  insert: function(deck) {
    return helper.connectToDatabase()
      .then((db) => db.collection('decks'))
      .then((col) => col.insertOne(deck)); //id is created and concatinated automagically
  },

  update: function(deck) {
    return helper.connectToDatabase()
      .then((db) => db.collection('decks'))
      .then((col) => col.findOneAndUpdate({
        _id: deck.id
      }, deck));
  }
};
