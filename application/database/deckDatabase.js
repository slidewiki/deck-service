'use strict';

const helper = require('./helper');

module.exports = {
  get: function(identifier) {
    return helper.connectToDatabase()
      .then((db) => db.collection('slides'))
      .then((col) => col.findOne({
        _id: oid(identifier)
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

function convertDeck(deck) {
  let now = new Date();
  return {
    user: deck.user,
    deck: deck.root_deck,
    timestamp: now,
    lastUpdate: now,
    license: deck.license,
    revisions: [{
      title: deck.title,
      timestamp: now,
      user: deck.user,
      visibility: false,
      contentItems: deck.content_items
    }]
  };
}
