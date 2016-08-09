/*
Controller for handling mongodb and the data model slide while providing CRUD'ish.
*/

'use strict';

const helper = require('./helper'),
  slideModel = require('../models/slide.js'),
  oid = require('mongodb').ObjectID;

module.exports = {
  get: function(identifier) {
    identifier = String(identifier);
    let idArray = identifier.split('-');
    return helper.connectToDatabase()
      .then((db) => db.collection('decks'))
      //must parse the identifier to check if it is dash separated (get revision) or not (get the whole slide)
      .then((col) => col.findOne({
        _id: parseInt(idArray[0])
      })
      .then((found) => {
        if(idArray.length === 1){
          return found;
        }
        else{
          //array index of revision is revision number minus 1
          let revision = found.revisions[parseInt(idArray[1])-1];
          found.revisions = [revision];
          return found;
          // revision.id = identifier;
          // revision.kind = 'slide';
          // return revision;
        }
      })
    );
  },
  getAll: function(identifier) {
    return helper.connectToDatabase()
      .then((db) => db.collection('decks'))
      .then((col) => col.find({ content_id: String(oid(identifier)) }))//TODO use id TODO cast to String?
      .then((stream) => stream.sort({timestamp: -1}))
      .then((stream) => stream.toArray());
  },

  getAllFromCollection: function() {
    return helper.connectToDatabase()
      .then((db) => db.collection('decks'))
      .then((col) => col.find())
      .then((stream) => stream.sort({timestamp: -1}))
      .then((stream) => stream.toArray());
  },

  insert: function(slide) {
    //TODO check for root and parent deck ids to be existant, otherwise create these
    return helper.connectToDatabase()
      .then((db) => helper.getNextIncrementationValueForCollection(db, 'decks'))
      .then((newId) => {
        return helper.connectToDatabase() //db connection have to be accessed again in order to work with more than one collection
          .then((db2) => db2.collection('decks'))
          .then((col) => {
            let valid = false;
            slide._id = newId;
            try {

              const convertedSlide = convertToNewSlide(slide);
              valid = slideModel(convertedSlide);
              // console.log('validated slidemodel', valid);
              if (!valid) {
                return slideModel.errors;
              }
              return col.insertOne(convertedSlide);
            } catch (e) {
              console.log('validation failed', e);
            }
            return;
          }); //id is created and concatinated automatically
      });
  },

  copy: function(slide, slideRevision){
    return helper.connectToDatabase()
      .then((db) => helper.getNextIncrementationValueForCollection(db, 'decks'))
      .then((newId) => {
        return helper.connectToDatabase() //db connection have to be accessed again in order to work with more than one collection
          .then((db2) => db2.collection('decks'))
          .then((col) => {
            let valid = false;
            slide._id = newId;
            let revisionCopied = slide.revisions[slideRevision];
            let now = new Date();
            let timestamp = now.toISOString();
            revisionCopied.parent = slide.parent;
            revisionCopied.comment = slide.comment;
            revisionCopied.id = 1;
            revisionCopied.timestamp = timestamp;
            slide.revisions = [revisionCopied];
            slide.timestamp = timestamp;
            delete slide.parent;
            delete slide.comment;
            try {
              return col.insertOne(slide);
            } catch (e) {
              console.log('validation failed', e);
            }
            return;
          }); //id is created and concatinated automatically
      });
  },

  replace: function(id, slide) {
    return helper.connectToDatabase()
      .then((db) => db.collection('decks'))
      .then((col) => {
        return col.findOne({_id: parseInt(id)}, {fields:{revisions:1}})
          .then((existingSlide) => {
            const maxRevisionId = existingSlide.revisions.reduce((prev, curr) => {
              if (curr.id > prev)
                return curr.id;

              return prev;
            }, 1);

            let valid = false;
            const slideWithNewRevision = convertSlideWithNewRevision(slide, parseInt(maxRevisionId)+1 );
            try {
              valid = slideModel(slideWithNewRevision);

              if (!valid) {
                return slideModel.errors;
              }

              return col.findOneAndUpdate({
                _id: parseInt(id)
              }, { $push: { revisions: slideWithNewRevision.revisions[0] } }, {new: true});
            } catch (e) {
              console.log('validation failed', e);
            }
            return;
          });
      });
  },

  replaceNoRevision: function(id, slide) {
    return helper.connectToDatabase()
      .then((db) => db.collection('decks'))
      .then((col) => {
        return col.findOne({_id: parseInt(id.split('-')[0])})
          .then((existingSlide) => {

            let valid = false;
            const slideWithNewRevision = convertSlideWithNewRevision(slide, parseInt(id.split('-')[1]));

            try {
              valid = slideModel(slideWithNewRevision);

              if (!valid) {
                return slideModel.errors;
              }

              existingSlide.revisions[parseInt(id.split('-')[1])-1] = slideWithNewRevision.revisions[0];
              col.save(existingSlide);
              return slideWithNewRevision;
            } catch (e) {
              console.log('validation failed', e);
            }
            return;
          });
      });
  },

  rename: function(slide_id, newName){
    let slideId = slide_id.split('-')[0];
    return helper.connectToDatabase()
    .then((db) => db.collection('decks'))
    .then((col) => col.findOne({_id: parseInt(slideId)})
    .then((slide) => {
      if(slide.revisions.length > 1){
        slide.revisions[slide_id.split('-')[1]-1].title = newName;
      }
      else{
        slide.revisions[0].title = newName;
      }
      return col.findOneAndUpdate({_id: parseInt(slideId)}, slide);
    }));
  },

  revert: function(slide_id, slide){ //this can actually revert to past and future revisions
    //NOTE must add validation on id
    return helper.connectToDatabase()
    .then((db) => db.collection('decks'))
    .then((col) => {
      col.findOne({_id: parseInt(slide_id)})
      .then((existingSlide) => {
        helper.connectToDatabase().collection('decks').findOne({_id: parseInt(existingSlide.deck)})
        .then((root_deck) => {
          //console.log(root_deck);
          for(let i = 0; i < root_deck.revisions.length; i++) {
            if(root_deck.revisions[i].id === root_deck.active) {
              for(let j = 0; j < root_deck.revisions[i].contentItems.length; j++) {
                if(root_deck.revisions[i].contentItems[j].ref.id === String(slide_id)) {
                  root_deck.revisions[i].contentItems[j].ref.revision = parseInt(slide.revision_id);
                }
                else continue;
              }
            }
            else continue;
          }
          col.save(root_deck);
        });
      });
    });
  }
};

function convertToNewSlide(slide) {
  let now = new Date();
  const result = {
    _id: slide._id,
    user: slide.user,
    kind: 'slide',
    deck: String(slide.root_deck.split('-')[0]),
    timestamp: now.toISOString(),
    language: slide.language,
    revisions: [{
      id: 1,
      timestamp: now.toISOString(),
      user: slide.user,
      license: slide.license,
      title: slide.title,
      content: slide.content,
      speakernotes: slide.speakernotes,
      parent: slide.parent_slide
    }]
  };
  //console.log('from', slide, 'to', result);
  return result;
}

function convertSlideWithNewRevision(slide, newRevisionId) {
  let now = new Date();
  const result = {
    user: slide.user,
    deck: slide.root_deck,
    timestamp: now.toISOString(),
    language: slide.language,
    revisions: [{
      id: newRevisionId,
      timestamp: now.toISOString(),
      user: slide.user,
      license: slide.license,
      title: slide.title,
      content: slide.content,
      speakernotes: slide.speakernotes,
      parent: slide.parent_slide
    }]
  };
  //console.log('from', slide, 'to', result);
  return result;
}
