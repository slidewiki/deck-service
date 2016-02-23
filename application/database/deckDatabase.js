'use strict';

const helper = require('./helper');

module.exports = {
  get: function(identifier) {
    return helper.connectToDatabase()
      .then((db) => db.collection('decks'))
      .then((coll) => coll.findONE({
        id: identifier
      }));
  },

  insert: function(deck) {
    return helper.connectToDatabase()
      .then((db) => db.collection('decks'))
      .then((coll) => coll.insertONE(deck)); //id is created and concatinated automagically
  },

  update: function(deck) {
    return helper.connectToDatabase()
      .then((db) => db.collection('decks'))
      .then((coll) => coll.updateONE({
        id: deck.id
      }, deck));
  }
};
