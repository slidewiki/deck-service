'use strict';

const helper = require('./helper');

module.exports = {
  get: function(identifier) {
    return helper.connectToDatabase()
      .then((db) => db.collection('slides'))
      .then((coll) => coll.findONE({
        id: identifier
      }));
  },

  insert: function(slide) {
    //TODO check for root and parent deck ids to be existant, otherwise create these
    return helper.connectToDatabase()
      .then((db) => db.collection('slides'))
      .then((coll) => coll.insertONE(slide)); //id is created and concatinated automagically
  },

  update: function(slide) {
    return helper.connectToDatabase()
      .then((db) => db.collection('slides'))
      .then((coll) => coll.updateONE({
        id: slide.id
      }, slide));
  }
};
