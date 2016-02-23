'use strict';

const helper = require('./helper');

module.exports = {
  get: function(identifier) {
    return helper.connectToDatabase()
      .then((db) => db.collection('slides'))
      .then((col) => col.findOne({
        _id: identifier
      }));
  },

  insert: function(slide) {
    //TODO check for root and parent deck ids to be existant, otherwise create these
    return helper.connectToDatabase()
      .then((db) => db.collection('slides'))
      .then((col) => col.insertOne(slide)); //id is created and concatinated automagically
  },

  update: function(slide) {
    return helper.connectToDatabase()
      .then((db) => db.collection('slides'))
      .then((col) => col.findOneAndUpdate({
        _id: slide.id
      }, slide));
  }
};
