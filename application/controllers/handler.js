/*
Handles the requests by executing stuff and replying to the client. Uses promises to get stuff done.
*/
/* eslint promise/always-return: "off" */



'use strict';

const _ = require('lodash');
const util = require('../lib/util');

const boom = require('boom'),
    slideDB = require('../database/slideDatabase'),
    deckDB = require('../database/deckDatabase'),
    treeDB = require('../database/deckTreeDatabase'),
    co = require('../common'),
    Joi = require('joi'),
    async = require('async');

// TODO remove this from here after we've refactored all database-specific code into slide/deck database js files
const ChangeLog = require('../lib/ChangeLog');

const userService = require('../services/user');
const tagService = require('../services/tag');
const fileService = require('../services/file');

const auth = require('./auth');

const slidetemplate = '<div class="pptx2html" style="position: relative; width: 960px; height: 720px;">'+

    '<div _id="2" _idx="undefined" _name="Title 1" _type="title" class="block content v-mid h-mid" style="position: absolute; top: 38.3334px; left: 66px; width: 828px; height: 139.167px; z-index: 23488;">'+
    '<h3>Title</h3></div>'+
    '<div _id="3" _idx="1" _name="Content Placeholder 2" _type="body" class="block content v-up" style="position: absolute; top: 191.667px; left: 66px; width: 828px; height: 456.833px; z-index: 23520;">'+
    '<ul>'+
    '	<li>Text bullet 1</li>'+
    '	<li>Text bullet 2</li>'+
    '</ul>'+
    '<div class="h-left">&nbsp;</div>'+
    '</div></div>';

let self = module.exports = {
    //returns a news ID of a legacy deck (with the revision number fort the user owning the legacy revision)
    getLegacyDeckId: function(request, reply) {
        deckDB.getLegacyId(request.params.oldId).then((id) => {
            if (co.isEmpty(id))
                reply(boom.notFound());
            else
                reply(id);
        }).catch((error) => {
            reply(error);
        });
    },

    //gets a single slide with all of its revisions, unless revision is defined
    getSlide: function(request, reply) {
        slideDB.get(encodeURIComponent(request.params.id)).then((slide) => {
            if (co.isEmpty(slide))
                reply(boom.notFound());
            else
                reply(slide);
        }).catch((error) => {
            request.log('error', error);
            reply(boom.badImplementation());
        });
    },

    //Get All Slides from database
    getAllSlides: function(request, reply) {
        slideDB.getAllFromCollection()
        .then((slides) => {
            slides.forEach((slide) => {
                co.rewriteID(slide);
            });

            let jsonReply = JSON.stringify(slides);
            reply(jsonReply);

        }).catch((error) => {
            request.log('error', error);
            reply(boom.badImplementation());
        });
    },

    // inserts a new slide into the database
    newSlide: function(request, reply) {
        let userId = request.auth.credentials.userid;

        // insert the slide
        slideDB.insert(request.payload, userId).then((inserted) => {
            // empty results means something wrong with the payload
            if (!inserted) throw boom.badData();

            let createdSlide = co.rewriteID(inserted);

            // create thumbnail from the newly created slide revision
            let content = createdSlide.revisions[0].content, slideId = createdSlide.id+'-'+1;
            // themeless
            fileService.createThumbnail(content, slideId).catch((err) => {
                request.log('warn', `could not create thumbnail for new slide ${slideId}: ${err.message || err}`);
            });

            return createdSlide;

        }).then(reply).catch((err) => {
            if (err.isBoom) return reply(err);
            request.log('error', err);
            reply(boom.badImplementation());
        });

    },

    //updates slide by creating a new revision
    // DEPRECATED
    updateSlide: function(request, reply) {
        let userId = request.auth.credentials.userid;
        let slideId = request.params.id;

        // fill in the user id from auth
        request.payload.user = userId;

        { // these brackets are kept during handleChange removal to keep git blame under control

            deckDB.getActiveRevisionFromDB(request.payload.root_deck).then((parentDeckId) => {

                //update root deck with active revision
                if(parentDeckId)
                    request.payload.root_deck = parentDeckId;

                //create the slide revision in the database
                return slideDB.replace(slideId, request.payload).then((slideRef) => {
                    // send tags to tag-service
                    if(request.payload.tags && request.payload.tags.length > 0){
                        tagService.upload(request.payload.tags, userId).catch( (e) => {
                            request.log('warning', 'Could not save tags to tag-service for slide ' + slideId + ': ' + e.message);
                        });
                    }

                    //we must update all decks in the 'usage' attribute
                    return slideDB.get(slideRef.id).then((newSlide) => {

                        // prepare the newSlide response object
                        newSlide.revisions = [newSlide.revisions[newSlide.revisions.length-1]];

                        // update the content item of the parent deck with the new revision id
                        return deckDB.updateContentItem(newSlide, '', request.payload.root_deck, 'slide', userId, request.payload.top_root_deck)
                        .then(({updatedDeckRevision}) => {
                            // the updateContentItem returns, amongs other things, the updated revision of the parent (root_deck)
                            // we need this to have access to the theme for the new updated slide

                            //create thumbnail for the new slide revision
                            let content = newSlide.revisions[0].content, newSlideId = newSlide._id+'-'+newSlide.revisions[0].id;
                            if(content === ''){
                                content = '<h2>'+newSlide.revisions[0].title+'</h2>';
                                //for now we use hardcoded template for new slides
                                content = slidetemplate;
                            }
                            fileService.createThumbnail(content, newSlideId, updatedDeckRevision.theme).catch((err) => {
                                request.log('warn', `could not create thumbnail for updated slide ${newSlideId}: ${err.message || err}`);
                            });

                            reply(newSlide);
                        });

                    });
                });

            }).catch((error) => {
                request.log('error', error);
                reply(boom.badImplementation());
            });

        }

    },

    // updates slide by creating a new revision
    updateSlideNode: function(request, reply) {
        let slideId = request.params.id;

        // ignore the language (TODO remove from API as well)
        delete request.payload.language;

        slideDB.exists(slideId).then((exists) => {
            if (!exists) throw boom.notFound();

            let rootId = request.payload.top_root_deck;
            return slideDB.findSlideNode(rootId, slideId).then((slideNode) => {
                if (!slideNode) {
                    throw boom.badData(`could not find slide: ${slideId} in deck tree: ${rootId}`);
                }

                let userId = request.auth.credentials.userid;
                let parentDeckId = util.toIdentifier(slideNode.parent);
                return auth.authorizeUser(userId, parentDeckId, rootId).then((boomError) => {
                    if (boomError) throw boomError;

                    return slideDB.updateSlideNode(slideNode, request.payload, userId).then((slideRef) => {
                        // send tags to tag-service
                        if (request.payload.tags && request.payload.tags.length > 0) {
                            tagService.upload(request.payload.tags, userId).catch( (e) => {
                                request.log('warning', 'Could not save tags to tag-service for slide ' + slideId + ': ' + e.message);
                            });
                        }

                        // we must update all decks in the 'usage' attribute
                        return slideDB.get(slideRef.id).then((newSlide) => {
                            // prepare the newSlide response object
                            newSlide.revisions = [_.find(newSlide.revisions, { id: slideRef.revision })];

                            let content = newSlide.revisions[0].content;
                            let newSlideId = util.toIdentifier(slideRef);
                            // create thumbnail for the new slide revision
                            fileService.createThumbnail(content, newSlideId, slideRef.theme).catch((err) => {
                                console.warn(`could not create thumbnail for updated slide ${newSlideId}, error was: ${err.message}`);
                            });

                            reply(newSlide);
                        });
                    });
                });
            });

        }).catch((err) => {
            if (err.isBoom) return reply(err);
            request.log('error', err);
            reply(boom.badImplementation());
        });

    },

    // reverts a slide to a previous revision, w.r.t. a parent deck
    revertSlideRevision: function(request, reply) {
        let slideId = request.params.id;

        slideDB.exists(slideId).then((exists) => {
            if (!exists) throw boom.notFound();

            let rootId = request.payload.top_root_deck;
            // we need to find the slide node in the tree!
            return slideDB.findSlideNode(rootId, slideId).then((slideNode) => {
                // could not find path due to bad payload
                if (!slideNode) {
                    throw boom.badData(`could not find slide: ${slideId} in deck tree: ${rootId} `);
                }

                let userId = request.auth.credentials.userid;
                let parentDeckId = util.toIdentifier(slideNode.parent);
                return auth.authorizeUser(userId, parentDeckId, rootId).then((boomError) => {
                    if (boomError) throw boomError;

                    let revisionId = parseInt(request.payload.revision_id);
                    return slideDB.revertSlideNode(slideNode, revisionId, userId).then((slideRef) => {
                        // if revert returns nothing, it's not because of 404, but no path was found!
                        if (!slideRef) {
                            throw boom.badData(`unknown revision id: ${revisionId} for slide: ${slideId}`);
                        }

                        let revertedSlideId = util.toIdentifier(slideRef);
                        return slideDB.get(revertedSlideId).then((updatedSlide) => {
                            // keep only the new slide revision in revisions array for response
                            let slideRevision = _.find(updatedSlide.revisions, { id: revisionId });
                            updatedSlide.revisions = [slideRevision];

                            // also, create a thumbnail with the parent deck's theme
                            fileService.createThumbnail(slideRevision.content, revertedSlideId, slideRef.theme).catch((err) => {
                                console.warn(`could not create thumbnail for reverted slide ${revertedSlideId}, error was: ${err.message}`);
                            });

                            return updatedSlide;
                        });

                    });

                });

            });

        }).then(reply).catch((err) => {
            if (err.isBoom) return reply(err);
            request.log('error', err);
            reply(boom.badImplementation());
        });

    },

    //saves the data sources of a slide in the database
    saveDataSources: function(request, reply) {
        let slideId = request.params.id;

        slideDB.get(slideId).then( (slide) => {
            if(!slide)  return reply(boom.notFound());

            return slideDB.saveDataSources(slideId, request.payload).then((replaced) => {
                reply(replaced);
            });
        }).catch( (error) => {
            request.log('error', error);
            reply(boom.badImplementation());
        });
    },

    getSlideDataSources: function(request, reply) {
        let slideId = request.params.id;
        slideDB.get(slideId).then((slide) => {
            if(!slide) return reply(boom.notFound());

            let items = slide.revisions[0].dataSources || [];
            let totalCount = items.length;
            if (request.query.countOnly) {
                items = [];
            }
            reply({ items, totalCount, revisionOwner: slide.user });
        }).catch((error) => {
            request.log('error', error);
            reply(boom.badImplementation());
        });
    },

    getDeckDataSources: function(request, reply) {
        deckDB.getRevision(request.params.id).then((deckRevision) => {
            // create data sources array
            if (!deckRevision) return reply(boom.notFound());

            // variant (translations) filter
            let variantFilter = _.pick(request.query, 'language');

            let dataSources = [];
            let arrayOfSlideIds = [];
            let slideRevisionsMap = {};

            return treeDB.getFlatSlides(request.params.id, variantFilter).then((deckTree) => {
                deckTree.children.forEach((child) => {
                    let idArray = child.id.split('-');
                    const newSlideId = parseInt(idArray[0]);
                    const newSlideRevisionId = parseInt(idArray[1]);
                    if (!(newSlideId in slideRevisionsMap)) {
                        arrayOfSlideIds.push(newSlideId);
                        slideRevisionsMap[newSlideId] = newSlideRevisionId;
                    }
                });
            }).then(() => {
                // get dataSources
                return slideDB.getSelected({selectedIDs: arrayOfSlideIds})// get slides with ids in arrayOfSlideIds
                .then((slides) => {
                    slides.forEach((slide) => {
                        if (slide.revisions !== undefined && slide.revisions.length > 0 && slide.revisions[0] !== null) {
                            const slideId = slide._id;
                            const slideRevisionId = slideRevisionsMap[slideId];
                            let slideRevision = slide.revisions.find((revision) =>  String(revision.id) ===  String(slideRevisionId));
                            if (slideRevision !== undefined && slideRevision.dataSources !== null && slideRevision.dataSources !== undefined) {
                                const slideRevisionTitle = slideRevision.title;
                                slideRevision.dataSources.forEach((dataSource) => {
                                    //check that the dataSource has not already been added to the array
                                    let unique = true;
                                    for (let i = 0; i < dataSources.length; i++) {
                                        let dataSourceInArray = dataSources[i];
                                        if (dataSourceInArray.type === dataSource.type &&
                                            dataSourceInArray.title === dataSource.title &&
                                            dataSourceInArray.url === dataSource.url &&
                                            dataSourceInArray.comment === dataSource.comment &&
                                            dataSourceInArray.authors === dataSource.authors)
                                        {
                                            unique = false;
                                            break;
                                        }
                                    }
                                    if (unique) {
                                        dataSource.sid = slideId + '-' + slideRevisionId;
                                        dataSource.stitle = slideRevisionTitle;
                                        dataSources.push(dataSource);
                                    }
                                });
                            }
                        }
                    });

                    let items = dataSources;
                    let totalCount = items.length;
                    if (request.query.countOnly) {
                        items = [];
                    }
                    reply({ items, totalCount, revisionOwner: deckRevision.user });
                });
            });

        }).catch((error) => {
            if (error.isBoom) return reply(error);

            request.log('error', error);
            reply(boom.badImplementation());
        });

    },

    // gets a single deck from the database, containing all revisions, unless a specific revision is specified in the id
    getDeck: function(request, reply) {
        let deckId = request.params.id;
        let variantFilter = _.pick(request.query, 'language');
        deckDB.get(deckId, variantFilter).then((deck) => {
            if (!deck) throw boom.notFound();

            // TODO this is only until we remove the damned revisions array from response payload
            // the last is the selected one, or the latest one
            let [defaultRevision] = deck.revisions.slice(-1);
            deck.language = defaultRevision.language;

            // add some deprecated names for revision, latestRevision
            let deckRef = util.parseIdentifier(deckId);
            if (deckRef.revision) {
                deck.revisionId = defaultRevision.id;
                // TODO remove this, not really latest
                deck.latestRevisionId = defaultRevision.id;
            } else {
                // default to active (?)
                deck.revisionId = deck.active;
                deck.latestRevisionId = defaultRevision.id;
            }

            // add first slide id-revision for all revisions
            deck.revisions.forEach((rev) => {
                rev.firstSlide = deckDB.getFirstSlide(rev);
            });

            return deck;

        }).then(reply).catch((err) => {
            if (err.isBoom) return reply(err);
            request.log('error', err);
            reply(boom.badImplementation());
        });
    },

    getDeckRevisions: function(request, reply) {
        let deckId = request.params.id; // it should already be a number

        deckDB.get(deckId).then((deck) => {
            if (!deck) throw boom.notFound();

            return deckDB.getChangesCounts(deckId).then((changesCounts) => {
                return deck.revisions.reverse().map((rev, index, list) => {
                    if (!rev.lastUpdate) {
                        // fill in missing lastUpdate from next revision
                        let nextRev = list[index + 1];
                        rev.lastUpdate = (nextRev && nextRev.timestamp) || deck.lastUpdate;
                    }

                    // keep only deck data
                    delete rev.contentItems;
                    delete rev.usage;

                    // normalize missing counts to 0
                    rev.changesCount = changesCounts[rev.id] || 0;

                    return rev;
                });
            });
        }).then(reply).catch((err) => {
            if (err.isBoom) return reply(err);
            request.log('error', err);
            reply(boom.badImplementation());
        });

    },

    // creates a new deck in the database
    newDeck: function(request, reply) {
        let userId = request.auth.credentials.userid;

        // insert the deck into the database
        deckDB.insert(request.payload, userId).then((inserted) => {
            // empty results means something wrong with the payload
            if (!inserted) throw boom.badData();
            let newDeckId = String(inserted._id) + '-1';

            // create a new slide inside the new deck
            let newSlide = Object.assign({
                // defaults
                title: 'New slide',
                content: slidetemplate,
                markdown: '',
                speakernotes: '',
            }, _.pick(request.payload, [
                'language',
                'license',
            ]), _.pick(request.payload.first_slide, [
                'title',
                'content',
                'markdown',
                'speakernotes',
            ]));

            if (request.payload.slideDimensions) {
                newSlide.dimensions = request.payload.slideDimensions;
            }

            return treeDB.createSlide(newSlide, newDeckId, 0, newDeckId, userId)
            .then((newContentItem) => co.rewriteID(inserted));

        }).then(reply).catch((err) => {
            if (err.isBoom) return reply(err);
            request.log('error', err);
            reply(boom.badImplementation(err));
        });
    },

    // new simpler implementation of deck update with permission checking and NO new_revision: true option
    updateDeck: function(request, reply) {
        let userId = request.auth.credentials.userid;
        let deckId = request.params.id;
        // TODO we should keep this required, no fall-back values!
        let rootDeckId = request.payload.top_root_deck;
        auth.authorizeUser(userId, deckId, rootDeckId).then((boom) => {
            // authorizeUser returns nothing if all's ok
            if (boom) throw boom;

            // force ignore new_revision
            delete request.payload.new_revision;

            // include user id in the payload!
            request.payload.user = userId;

            // update the deck without creating a new revision
            return deckDB.update(deckId, request.payload).then((result) => {
                if (!result) throw boom.notFound();
                let {replaced, changed} = result;

                // send tags to tag-service
                if (!_.isEmpty(request.payload.tags)) {
                    tagService.upload(request.payload.tags, userId).catch((e) => {
                        request.log('warning', 'Could not save tags to tag-service for deck ' + request.params.id + ': ' + e.message);
                    });
                }

                if (!changed.theme) return replaced;

                // theme was changed, update thumbs for all direct slides
                return slideDB.getDeckSlides(deckId).then((slides) => {
                    for (let slide of slides) {
                        let slideId = util.toIdentifier(slide);
                        fileService.createThumbnail(slide.content, slideId, changed.theme).catch((err) => {
                            console.warn(`could not update thumbnail for slide ${slideId}, error was: ${err.message}`);
                        });
                    }

                    return replaced;
                }).catch((err) => {
                    console.warn(`could not update slide thumbnails for deck ${deckId}, error was: ${err.message}`);
                });

            });

        }).then(reply).catch((err) => {
            if (err.isBoom) return reply(err);
            request.log('error', err);
            reply(boom.badImplementation());
        });

    },

    getDeckVariants: function(request, reply){
        deckDB.getDeckVariants(request.params.id).then((variants) => {
            if (!variants) return reply(boom.notFound());
            reply(variants);
        }).catch((error) => {
            request.log('error', error);
            reply(boom.badImplementation());
        });
    },

    addDeckVariant: function(request, reply) {
        let userId = request.auth.credentials.userid;
        let deckId = request.params.id;

        auth.authorizeUser(userId, deckId, deckId).then((boom) => {
            // authorizeUser returns nothing if all's ok
            if (boom) throw boom;

            // reply new variant data on success
            return deckDB.addDeckVariant(deckId, request.payload, userId);
        }).then(reply).catch((err) => {
            if (err.isBoom) return reply(err);
            request.log('error', err);
            reply(boom.badImplementation());
        });

    },

    getDeckForks: function(request, reply) {
        let deckId = request.params.id;
        let userId = request.query.user || undefined;

        deckDB.getDeckForks(deckId, userId).then((forks) => {
            if (!forks) return reply(boom.notFound());

            // do some formatting
            reply(forks.map((fork) => {
                let [latestRevision] = fork.revisions.slice(-1);

                fork.id = fork._id;
                fork.title = latestRevision.title;

                return _.pick(fork, [
                    'id', 'title', 'user',
                    'hidden',
                    'timestamp', 'lastUpdate', 'current', 'origin',
                ]);

            }));
        }).catch((err) => {
            request.log('error', err);
            reply(boom.badImplementation());
        });
    },

    countDeckForks: function(request, reply) {
        let deckId = request.params.id;
        let userId = request.query.user || undefined;

        deckDB.countDeckForks(deckId, userId).then((forkCount) => {
            if (_.isNil(forkCount)) return reply(boom.notFound());

            reply(forkCount);
        }).catch((err) => {
            request.log('error', err);
            reply(boom.badImplementation());
        });
    },

    forkDeckRevision: function(request, reply) {
        let deckId = request.params.id;
        let userId = request.auth.credentials.userid;

        return deckDB.forkAllowed(deckId, userId)
        .then((forkAllowed) => {
            if (!forkAllowed) {
                return reply(boom.forbidden());
            }

            return treeDB.copyDeckTree(deckId, userId).then((id_map) => {
                reply(id_map);
            });

        }).catch((error) => {
            request.log('error', error);
            reply(boom.badImplementation());
        });

    },

    // simply creates a new deck revision without updating anything
    createDeckRevision: function(request, reply) {
        let userId = request.auth.credentials.userid;

        let deckId = request.params.id;
        let rootDeckId = request.payload.top_root_deck;

        auth.authorizeUser(userId, deckId, rootDeckId).then((boom) => {
            // authorizeUser returns nothing if all's ok
            if (boom) throw boom;

            return deckDB.createDeckRevision(deckId, userId, rootDeckId);
        }).then(reply).catch((err) => {
            if (err.isBoom) return reply(err);
            request.log('error', err);
            reply(boom.badImplementation());
        });

    },

    // reverts a deck into a past revision
    revertDeckRevision: function(request, reply) {
        let userId = request.auth.credentials.userid;

        let deckId = request.params.id;
        let rootDeckId = request.payload.top_root_deck;

        auth.authorizeUser(userId, deckId, rootDeckId).then((boom) => {
            // authorizeUser returns nothing if all's ok
            if (boom) throw boom;

            // continue as normal
            let revisionId = request.payload.revision_id;

            return deckDB.revertDeckRevision(deckId, revisionId, userId, rootDeckId)
            .then((updatedDeck) => {
                // means the revision_id in the payload was invalid
                if (!updatedDeck) {
                    throw boom.badData(`could not find ${revisionId} for deck ${deckId}`);
                }

                return updatedDeck;
            });

        }).then(reply).catch((err) => {
            if (err.isBoom) return reply(err);
            request.log('error', err);
            reply(boom.badImplementation());
        });

    },

    //gets the decktree with the given deck as root
    getDeckTree: function(request, reply) {
        if(request.query && request.query.enrich) {
            deckDB.get(request.params.id).then( (existingDeck) => {
                if(!existingDeck) return reply(boom.notFound());

                return deckDB.getEnrichedDeckTree(request.params.id).then( (decktree) => {
                    reply(decktree);
                });
            }).catch( (err) => {
                if(err.isBoom) return reply(err);

                request.log('error', err);
                reply(boom.badImplementation());
            });
        } else {
            treeDB.getDeckTree(request.params.id, _.pick(request.query, 'language'))
            .then((deckTree) => {
                if (!deckTree) return reply(boom.notFound());

                if (co.isEmpty(deckTree))
                    reply(boom.notFound());
                else{
                    reply(deckTree);
                }
            }).catch((err) => {
                if(err.isBoom) return reply(err);

                request.log('error', err);
                reply(boom.badImplementation());
            });
        }
    },

    // authorize node creation and iterate nodeSpec array to apply each insert
    // DEPRECATED
    createDeckTreeNodeWithCheck: function(request, reply) {
        let userId = request.auth.credentials.userid;
        let rootDeckId = request.payload.selector.id;

        // TODO proper authorization checking the actual parent id
        return authorizeUser(userId, rootDeckId, rootDeckId).then((boomError) => {
            if (boomError) return reply(boomError);

            let nodeSpecs = request.payload.nodeSpec;
            if (nodeSpecs.length < 2) {
                request.payload.nodeSpec = nodeSpecs[0];
                return self.createDeckTreeNode(request, reply);
            }

            // do some complex validations
            // we only support more than one nodeSpec when attaching,
            // so isMove cannot be true
            if (request.payload.isMove) {
                return reply(boom.badData());
            }

            // also, all ids should be valid numbers
            if (!nodeSpecs.every((node) => node.id && node.id !== '0')) {
                return reply(boom.badData());
            }

            // check if we append at the end (no position argument) or at a position
            let reverseOrder = (request.payload.selector.stype === 'slide');
            if (reverseOrder) {
                // if we *don't* attach to the end, we need to
                // reverse the node specs because they are added right after
                // the position specified in selector, like in a stack (LIFO)
                // we would like to provide the semantics of a queue (FIFO)
                nodeSpecs.reverse();
            } else {
                // if appending to deck lets remove the spath because we always attach to the last position
                request.payload.selector.spath = '';
            }

            async.concatSeries(nodeSpecs, (nodeSpec, done) => {
                // just put this nodespec
                request.payload.nodeSpec = nodeSpec;

                self.createDeckTreeNode(request, (result) => {
                    // an error already logged
                    if (result && result.isBoom) done(result);

                    // result is not an error
                    done(null, result);
                });
            }, (err, results) => {
                if (err) {
                    // an error already logged
                    if (err.isBoom) {
                        reply(err);
                    } else {
                        // an error in this method code, not logged
                        request.log('error', err);
                        reply(boom.badImplementation());
                    }
                } else {
                    // if needed, we again reverse the results to match the node spec order
                    if (reverseOrder) results.reverse();

                    reply(results);
                }
            });
        });

    },

    //creates a node (deck or slide) into the given deck tree
    // DEPRECATED
    createDeckTreeNode: function(request, reply) {
        let node = {};
        let top_root_deck = request.payload.selector.id;
        let userId = request.auth.credentials.userid;

        //check if it is a slide or a deck
        if(request.payload.nodeSpec.type === 'slide'){
            if(request.payload.nodeSpec.id && request.payload.nodeSpec.id !== '0'){
                //it means it is an existing node, we should retrieve the details
                let spath = request.payload.selector.spath;
                let spathArray = spath.split(';');
                let parentID, slidePosition;
                if(spathArray.length > 1){

                    let parentArrayPath = spathArray[spathArray.length-2].split(':');
                    parentID = parentArrayPath[0];

                } else if (request.payload.selector.stype === 'deck') {
                    parentID = request.payload.selector.sid;
                } else {
                    // means we are at root deck
                    parentID = request.payload.selector.id;
                }

                let slideArrayPath = spathArray[spathArray.length-1].split(':');
                slidePosition = parseInt(slideArrayPath[1])+1;

                // TODO remove this deprecated part of the code
                if (request.payload.isMove) {
                    let slideRevision = parseInt(request.payload.nodeSpec.id.split('-')[1])-1;
                    self.getSlide({
                        'params' : {'id' : request.payload.nodeSpec.id.split('-')[0]},
                        'log': request.log.bind(request),
                    }, (slide) => {
                        if (slide.isBoom) return reply(slide);

                        //change position of the existing slide
                        slide.id = slide._id;

                        deckDB.insertNewContentItem(slide, slidePosition, parentID, 'slide', slideRevision+1, userId, top_root_deck)
                        .then((updatedDeckRevision) => {
                            // since we moved the slide maybe it's under a deck with a different theme, so let's create the thumbnail as well
                            let slideId = slide.id+'-'+(slideRevision+1);
                            fileService.createThumbnail(slide.revisions[slideRevision].content, slideId, updatedDeckRevision.theme).catch((err) => {
                                request.log('warn', `could not create thumbnail for slide duplicate ${slideId}: ${err.message || err}`);
                            });

                            return slideDB.addToUsage({ref:{id:slide._id, revision: slideRevision+1}, kind: 'slide'}, parentID.split('-')).then(() => {
                                node = {title: slide.revisions[slideRevision].title, id: slide.id+'-'+slide.revisions[slideRevision].id, type: 'slide'};
                                reply(node);
                            });
                        }).catch( (err) => {
                            request.log('error', err);
                            reply(boom.badImplementation());
                        });

                    });

                    // finished
                    return;
                }

                // we are attaching a copy of a slide that may or may not be in the current tree
                let slideId = request.payload.nodeSpec.id;
                // let's keep the exact action tracked
                let addAction = 'attach';
                if (request.payload.nodeSpec.id === request.payload.selector.sid) {
                    // this means we create a slide duplicate and insert after the slide in selector
                    addAction = 'copy';
                }

                // if nodeSpec.root is defined, means it's an external attach of a slide in a deck
                let slideRootId = request.payload.nodeSpec.root;
                if (slideRootId) {
                    // we attach the slide with its variants (translations)
                    slideDB.findSlideNode(slideRootId, slideId).then((slideNode) => {
                        if (!slideNode) {
                            return reply(boom.badData(`could not find slide: ${slideId} in deck tree: ${slideRootId}`));
                        }

                        // we must duplicate the slide node
                        return slideDB.copySlideNode(slideRootId, slideId, parentID, userId).then((newContentItem) => {
                            return deckDB.insertContentItem(newContentItem, slidePosition, parentID, userId, top_root_deck, addAction).then((updatedDeckRevision) => {
                                let theme = updatedDeckRevision.theme;
                                return slideDB.getContentItemSlides(newContentItem).then((slides) => {
                                    // generate thumbnails but don't wait for it
                                    for (let slide of slides) {
                                        let newSlideId = util.toIdentifier(slide);
                                        fileService.createThumbnail(slide.content, newSlideId, theme).catch((err) => {
                                            console.warn(`could not create thumbnail for slide ${newSlideId}, error was: ${err.message}`);
                                        });
                                    }

                                    // the node data are the same as the original
                                    reply({ title: slideNode.slide.title, id: util.toIdentifier(newContentItem.ref), type: 'slide' });
                                });

                            });

                        });

                    }).catch((err) => {
                        request.log('error', err);
                        reply(boom.badImplementation());
                    });

                } else {
                    // otherwise, we keep things backwards-compatible and insert a simple slide copy.
                    // in this case the slide copy will have the same language as the deck tree we are attaching to
                    slideDB.getSlideRevision(slideId).then((slide) => {
                        if (!slide) {
                            return reply(boom.badData(`could not locate slide to attach: ${slideId}`));
                        }

                        return slideDB.copy(slide, parentID, userId).then((inserted) => {
                            // it's slide copy, so revision is 1
                            let newContentItem = { ref: { id: inserted._id, revision: 1 }, kind: 'slide' };
                            return deckDB.insertContentItem(newContentItem, slidePosition, parentID, userId, top_root_deck, addAction).then((updatedDeckRevision) => {
                                // we can now pick the theme of the parent deck and create the thumbnail!
                                let newSlideId = util.toIdentifier(newContentItem.ref);
                                fileService.createThumbnail(inserted.revisions[0].content, newSlideId, updatedDeckRevision.theme).catch((err) => {
                                    console.warn(`could not create thumbnail for slide ${newSlideId}, error was: ${err.message}`);
                                });

                                // the node data are the same as the original
                                reply({ title: slide.title, id: newSlideId, type: 'slide' });
                            });
                        });

                    }).catch((err) => {
                        request.log('error', err);
                        reply(boom.badImplementation());
                    });

                }

            }else{
                //need to make a new slide
                let spath = request.payload.selector.spath;
                let spathArray = spath.split(';');
                let parentID, slidePosition;
                if(spathArray.length > 1){

                    let parentArrayPath = spathArray[spathArray.length-2].split(':');
                    parentID = parentArrayPath[0];

                }
                else{
                    parentID = request.payload.selector.id;
                }
                let slideArrayPath = spathArray[spathArray.length-1].split(':');
                slidePosition = parseInt(slideArrayPath[1])+1;
                if(request.payload.selector.stype === 'deck'){
                    //selector is deck, we can get the root deck id directly
                    parentID = request.payload.selector.sid;
                    slidePosition = 0;
                }

                { // these brackets are kept during handleChange removal to keep git blame under control

                    self.getDeck({
                        'params': {'id':parentID},
                        'log': request.log.bind(request),
                    }, (parentDeck) => {
                        if (parentDeck.isBoom) return reply(parentDeck);

                        let slide = {
                            'title': 'New slide',
                            'content': slidetemplate,
                            'allowMarkdown': false,
                            'markdown': '',
                            'language': parentDeck.revisions[0].language,
                            'license': parentDeck.license,
                            'root_deck': parentID,
                            'position' : slidePosition,
                            'user': userId,
                            'theme' : request.payload.theme,
                        };

                        if (parentDeck.slideDimensions) {
                            slide.dimensions = parentDeck.slideDimensions;
                        }
                        if(request.payload.hasOwnProperty('content')){
                            slide.content = request.payload.content;
                        }
                        if(request.payload.hasOwnProperty('markdown')){
                            slide.markdown = request.payload.markdown;
                        }
                        if(request.payload.hasOwnProperty('allowMarkdown')){
                            slide.allowMarkdown = request.payload.allowMarkdown;
                        }
                        if(request.payload.hasOwnProperty('title')){
                            slide.title = request.payload.title;
                        }
                        if(request.payload.hasOwnProperty('license')){
                            slide.license = request.payload.license;
                        }
                        if(request.payload.hasOwnProperty('speakernotes')){
                            slide.speakernotes = request.payload.speakernotes;
                        }

                        // create the new slide into the database

                        // insert the slide
                        slideDB.insert(slide).then((inserted) => {
                            // empty results means something wrong with the payload
                            if (!inserted) throw boom.badData();

                            let createdSlide = co.rewriteID(inserted);

                            node = {title: createdSlide.revisions[0].title, id: createdSlide.id+'-'+createdSlide.revisions[0].id, type: 'slide'};

                            //we have to return from the callback, else empty node is returned because it is updated asynchronously
                            return deckDB.insertNewContentItem(createdSlide, slidePosition, parentID, 'slide', 1, userId, top_root_deck).then((updatedDeckRevision) => {

                                // slide is now inserted, so we can create the thumbnail using the (direct) parent deck theme

                                // create thumbnail from the newly created slide revision
                                let content = createdSlide.revisions[0].content, slideId = createdSlide.id+'-'+1;
                                if (content === '') {
                                    // content = '<h2>'+inserted.revisions[0].title+'</h2>';
                                    // TODO for now we use hardcoded template for new slides
                                    content = slidetemplate;
                                }

                                // don't wait for it before returning
                                fileService.createThumbnail(content, slideId, updatedDeckRevision.theme).catch((err) => {
                                    request.log('warn', `could not create thumbnail for new slide ${slideId}: ${err.message || err}`);
                                });

                                reply(node);
                            });

                        }).catch((err) => {
                            if (err.isBoom) return reply(err);

                            request.log('error', err);
                            reply(boom.badImplementation());
                        });
                    });
                }
            }
        }else{
            //create a deck node
            if(request.payload.nodeSpec.id && request.payload.nodeSpec.id !== '0'){
                //id is specified, it means it is an existing node
                let spath = request.payload.selector.spath;
                let spathArray = spath.split(';');
                let parentID, deckPosition;
                if(spathArray.length > 1){

                    let parentArrayPath = spathArray[spathArray.length-2].split(':');
                    parentID = parentArrayPath[0];

                }
                else{
                    parentID = request.payload.selector.sid;
                }
                if(request.payload.selector.stype === 'slide'){
                    parentID = request.payload.selector.id;
                }

                let deckArrayPath = spathArray[spathArray.length-1].split(':');
                deckPosition = parseInt(deckArrayPath[1])+1;
                let deckRevision = parseInt(request.payload.nodeSpec.id.split('-')[1])-1;

                //NOTE must check if it is a move action, if not, we are appending an external subdeck and we need to fork it
                if(request.payload.isMove){
                    // TODO remove this deprecated part of the code
                    self.getDeck({
                        'params': {'id' : request.payload.nodeSpec.id},
                        'log': request.log.bind(request),
                    }, (deck) => {
                        if (deck.isBoom) return reply(deck);

                        deck.id = deck._id;

                        { // these brackets are kept during handleChange removal to keep git blame under control

                            if(request.payload.selector.stype === 'deck'){
                                parentID = request.payload.selector.sid;
                            }
                            else{
                                parentID = request.payload.selector.id;
                            }

                            let insertContentItemPromise = deckDB.insertNewContentItem(deck, deckPosition, parentID, 'deck', deckRevision+1, userId, top_root_deck);
                            let addToUsagePromise = deckDB.addToUsage({ref:{id:deck._id, revision: deckRevision+1}, kind: 'deck'}, parentID.split('-'));

                            Promise.all([insertContentItemPromise, addToUsagePromise]).then( () => {
                                //we have to return from the callback, else empty node is returned because it is updated asynchronously
                                self.getDeckTree({
                                    'params': {'id' : deck.id},
                                    'log': request.log.bind(request),
                                }, (deckTree) => {
                                    if (deckTree.isBoom) return reply(deckTree);

                                    reply(deckTree);
                                });
                            }).catch( (err) => {
                                request.log('error', err);
                                reply(boom.badImplementation());
                            });

                        }
                    });
                }
                else{
                    // find the parent, again
                    if(request.payload.selector.stype === 'deck'){
                        parentID = request.payload.selector.sid;
                    }
                    else{
                        parentID = request.payload.selector.id;
                    }

                    let sourceId = request.payload.nodeSpec.id;
                    treeDB.attachDeckTree(sourceId, parentID, deckPosition, top_root_deck, userId).then((forkResult) => {
                        if (!forkResult) {
                            // source id not found
                            return reply(boom.badData(`could not locate specified deck: ${sourceId}`));
                        }
                        //we have to return from the callback, else empty node is returned because it is updated asynchronously
                        return treeDB.getDeckTree(forkResult.root_deck).then((deckTree) => {
                            reply(deckTree);
                        });
                    }).catch((err) => {
                        request.log('error', err);
                        reply(boom.badImplementation());
                    });
                }
            }else{
                //id is not specified, we need to make a new deck
                let spath = request.payload.selector.spath;
                let spathArray = spath.split(';');
                let parentID, deckPosition;
                if(spathArray.length > 1){

                    let parentArrayPath = spathArray[spathArray.length-2].split(':');
                    parentID = parentArrayPath[0];

                }
                else{
                    parentID = request.payload.selector.id;
                }
                if(request.payload.selector.stype === 'deck'){
                    parentID = request.payload.selector.sid;
                }

                let deckArrayPath = spathArray[spathArray.length-1].split(':');
                deckPosition = parseInt(deckArrayPath[1])+1;

                let payload = {
                    title: 'New deck',
                    description: '',
                };
                treeDB.createSubdeck(payload, parentID, deckPosition, top_root_deck, userId).then((newDeck) => {
                    // this creates an empty subdeck, let's also add a sample slide
                    // init the payload from the optional first_slide object data
                    let payload = Object.assign({
                        title: 'New slide',
                        content: slidetemplate,
                        markdown: '',
                        speakernotes: '',
                    }, request.payload.first_slide);

                    return treeDB.createSlide(payload, util.toIdentifier(newDeck.ref), 0, top_root_deck, userId).then((newSlide) => {
                        // we have to return from the callback, else empty node is returned because it is updated asynchronously
                        return treeDB.getDeckTree(newDeck.ref.id).then((newTree) => {
                            // let's create a thumbnail but dont wait for it
                            let slideId = util.toIdentifier(newSlide.ref);
                            fileService.createThumbnail(payload.content, slideId, newTree.theme).catch((err) => {
                                request.log('warn', `could not create thumbnail for new slide ${slideId}: ${err.message || err}`);
                            });

                            reply(newTree);
                        });
                    });

                }).catch((err) => {
                    request.log('error', err);
                    reply(boom.badImplementation());
                });
            }
        }
    },

    //renames a decktree node (slide or deck)
    // DEPRECATED
    renameDeckTreeNode: function(request, reply) {
        let userId = request.auth.credentials.userid;

        //check if it is deck or slide
        if(request.payload.selector.stype === 'deck'){
            let root_deck = request.payload.selector.sid;

            { // these brackets are kept during handleChange removal to keep git blame under control

                let top_root_deck = request.payload.selector.id;
                deckDB.rename(root_deck, request.payload.name, {}, top_root_deck, userId).then((renamed) => {
                    let response = {'title' : renamed};
                    reply(response);
                }).catch((error) => {
                    request.log('error', error);
                    reply(boom.badImplementation());
                });
            }

        }else {
            //it is a slide, must find root deck id
            let root_deck ;
            let slide_id = request.payload.selector.sid;
            let spath = request.payload.selector.spath;
            let spathArray = spath.split(';');
            if(spathArray.length > 1){
                let parentArrayPath = spathArray[spathArray.length-2].split(':');
                root_deck = parentArrayPath[0];
            }
            else{
                root_deck = request.payload.selector.id;
            }
            //we must create a new slide revision as well, because of renaming it
            self.getSlide({
                'params' : {'id' : slide_id},
                'log': request.log.bind(request),
            }, (slide) => {
                if (slide.isBoom) return reply(slide);

                let new_slide = {
                    'title' : request.payload.name,
                    'content' : slide.revisions[0].content,
                    'markdown' : slide.revisions[0].markdown,
                    'speakernotes' : slide.revisions[0].speakernotes,
                    'user' : String(userId),
                    'root_deck' : root_deck,
                    'top_root_deck' : request.payload.selector.id,
                    'language' : slide.language,
                    'license' : slide.license,
                    'tags' : slide.revisions[0].tags,
                    'dataSources' : slide.revisions[0].dataSources
                };
                if (slide.revisions[0].dimensions) {
                    new_slide.dimensions = slide.revisions[0].dimensions;
                }
                if(new_slide.speakernotes === null){
                    new_slide.speakernotes = '';
                }
                if(new_slide.tags === null){
                    new_slide.tags = [];
                }
                if(new_slide.dataSources === null){
                    new_slide.dataSources = [];
                }
                let forwardedRequest = {
                    'params' : {'id' :encodeURIComponent(slide_id)},
                    'payload' : new_slide,
                    'auth': request.auth,
                    'log': request.log.bind(request),
                };
                self.updateSlide(forwardedRequest, (updated) => {
                    reply(updated);
                });
            });
        }
    },
    //deletes a decktree node by removing its reference from its parent deck (does not actually delete it from the database)
    // DEPRECATED
    deleteDeckTreeNode: function(request, reply) {
        let userId = request.auth.credentials.userid;

        //NOTE no removal in the DB, just unlink from content items, and update the positions of the other elements
        let spath = request.payload.selector.spath;
        let spathArray = spath.split(';');
        let parentID, itemPosition;
        if(spathArray.length > 1){

            let parentArrayPath = spathArray[spathArray.length-2].split(':');
            parentID = parentArrayPath[0];

        }
        else{
            parentID = request.payload.selector.id;
        }

        let itemArrayPath = spathArray[spathArray.length-1].split(':');
        itemPosition = itemArrayPath[1];

        { // these brackets are kept during handleChange removal to keep git blame under control

            //remove link of content item from db
            let top_root_deck = request.payload.selector.id;
            deckDB.removeContentItem(itemPosition, parentID, top_root_deck, userId)
            .then((removed) => {
                if(!removed){
                    removed = {};
                }
                reply(removed);
            })
            .catch((err) => {
                request.log('error', err);
                reply(boom.badImplementation());
            });
        }

    },
    //changes position of a deck tree node inside the decktree
    // DEPRECATED
    moveDeckTreeNode: function(request, reply) {
        let userId = request.auth.credentials.userid;

        //first delete the node from its current position
        self.deleteDeckTreeNode({
            'payload': {'selector' : request.payload.sourceSelector, 'user': String(userId), 'isMove' : true},
            'auth': request.auth,
            'log': request.log.bind(request),
        },
        (removed) => {
            if (removed.isBoom) return reply(removed);
            //must update revision ids
            let nodeSpec = {'id': request.payload.sourceSelector.sid, 'type': request.payload.sourceSelector.stype};
            let sourceParentDeck = request.payload.sourceSelector.id;
            let spathArray = request.payload.sourceSelector.spath.split(';');
            if(spathArray.length > 1){

                let parentArrayPath = spathArray[spathArray.length-2].split(':');
                sourceParentDeck = parentArrayPath[0];
            }
            let targetParentDeck = request.payload.targetSelector.id;
            if(request.payload.targetSelector.spath !== ''){
                if(request.payload.targetSelector.stype === 'deck'){
                    targetParentDeck = request.payload.targetSelector.sid;
                }
                else{
                    let targetspathArray = request.payload.targetSelector.spath.split(';');
                    if(targetspathArray.length > 1){

                        let parentArrayPath = targetspathArray[targetspathArray.length-2].split(':');
                        targetParentDeck = parentArrayPath[0];
                    }
                    else{
                        let parentArrayPath = targetspathArray[targetspathArray.length-1].split(':');
                        targetParentDeck = parentArrayPath[0];
                    }
                }

            }

            let removed_changeset, inserted_changeset ;
            if(removed.hasOwnProperty('changeset')){
                //handle changes coming from the recursive revisioning
                removed_changeset = removed.changeset;
                if(removed_changeset.hasOwnProperty('new_revisions')){
                    for(let i = 0; i < removed_changeset.new_revisions.length; i++){
                        let next_new_revision = removed_changeset.new_revisions[i];
                        if(i === 0 && removed_changeset.new_revisions[i].hasOwnProperty('root_changed')){
                            next_new_revision = removed_changeset.new_revisions[i].root_changed;
                        }
                        let next_new_revision_path = next_new_revision.split('-');
                        if(sourceParentDeck.split('-')[0] === next_new_revision_path[0]){
                            sourceParentDeck = sourceParentDeck.split('-')[0] + '-' + next_new_revision_path[1];
                        }
                        if(targetParentDeck.split('-')[0] === next_new_revision_path[0]){
                            targetParentDeck = targetParentDeck.split('-')[0] + '-' + next_new_revision_path[1];
                        }
                        if(request.payload.targetSelector.sid.split('-')[0] === next_new_revision_path[0]){
                            request.payload.targetSelector.sid = request.payload.targetSelector.sid.split('-')[0] + '-' + next_new_revision_path[1];
                        }
                        if(request.payload.targetSelector.id.split('-')[0] === next_new_revision_path[0]){
                            request.payload.targetSelector.id = request.payload.targetSelector.id.split('-')[0] + '-' + next_new_revision_path[1];
                        }
                        if(nodeSpec.id.split('-')[0] === next_new_revision_path[0]){
                            nodeSpec.id = nodeSpec.id.split('-')[0] + '-' + next_new_revision_path[1];
                        }
                    }
                }
            }

            let itemArrayPath = spathArray[spathArray.length-1].split(':');
            let itemPosition = itemArrayPath[1];
            if(sourceParentDeck === targetParentDeck && parseInt(itemPosition) < request.payload.targetIndex){
                request.payload.targetIndex--;
            }
            request.payload.targetSelector.spath = request.payload.targetSelector.sid + ':' + request.payload.targetIndex;
            if(request.payload.targetSelector.id.split('-')[0] === request.payload.targetSelector.sid.split('-')[0]){
                request.payload.targetSelector.id = request.payload.targetSelector.sid;
            }
            let forwardedRequest  = {
                'payload': {
                    'selector': request.payload.targetSelector,
                    'nodeSpec': nodeSpec,
                    'isMove' : true
                },
                'auth': request.auth,
                'log': request.log.bind(request),
            };
            //append the node (revised or not) in the new position
            self.createDeckTreeNode(forwardedRequest,
                (inserted) => {
                    if (inserted.isBoom) return reply(inserted);

                    if(inserted.hasOwnProperty('changeset') && removed.hasOwnProperty('changeset')){
                        inserted_changeset = inserted.changeset;
                        inserted.inserted_changeset = inserted_changeset;
                        inserted.removed_changeset = removed_changeset;
                    }
                    else if(removed.hasOwnProperty('changeset')){
                        inserted.changeset = removed_changeset;
                    }
                    if(inserted.hasOwnProperty('changeset')){
                        inserted_changeset = inserted.changeset;
                        inserted.changeset = inserted_changeset;
                    }
                    reply(inserted);
                });
        });

    },

    getDeckTreeNodeVariants: function(request, reply) {
        let rootDeckId = request.query.id;

        // only doing this to return proper http error
        return deckDB.getDeck(rootDeckId).then((rootDeck) => {
            if (!rootDeck) throw boom.notFound();

            // let's only worry about slides for now
            if (request.query.stype !== 'slide') {
                throw boom.badRequest('getting translations for a subdeck is not supported');
            }

            let slideId = request.query.sid;
            return slideDB.findSlideNode(rootDeckId, slideId).then((slideNode) => {
                if (!slideNode) {
                    throw boom.badData(`could not find slide: ${slideId} in deck tree: ${rootDeckId}`);
                }

                reply(slideNode.variants);
            });

        }).catch((err) => {
            if (err.isBoom) return reply(err);

            request.log('error', err);
            reply(boom.badImplementation());
        });
    },

    addDeckTreeNodeVariant: function(request, reply) {
        let userId = request.auth.credentials.userid;
        let {id: rootDeckId} = util.parseIdentifier(request.payload.selector.id);
        // will ignore any revision included here

        // TODO proper authorization checking the actual parent id
        return auth.authorizeUser(userId, rootDeckId, rootDeckId).then((boomError) => {
            if (boomError) throw boomError;

            // let's only worry about slides for now
            if (request.payload.selector.stype !== 'slide') {
                throw boom.badData('adding translations to a subdeck is not supported');
            }

            // latest revision only!
            return deckDB.getDeckVariants(rootDeckId).then((variants) => {
                // check if the language is in deck variants
                let variantFilter = _.pick(request.payload, 'language');
                let existingVariant = _.find(variants, variantFilter);
                if (!existingVariant) {
                    throw boom.badData(`missing deck variant for ${Object.entries(variantFilter)} in deck ${rootDeckId}`);
                }

                // locate the node
                let slideId = request.payload.selector.sid;
                return slideDB.findSlideNode(rootDeckId, slideId).then((slideNode) => {
                    if (!slideNode) {
                        throw boom.badData(`could not find slide: ${slideId} in deck tree: ${rootDeckId}`);
                    }

                    // check if node variant exists already
                    if (_.find(slideNode.variants, variantFilter) ) {
                        throw boom.badData(`variant for ${Object.entries(variantFilter)} already exists for slide: ${slideId} in deck tree: ${rootDeckId}`);
                    }

                    return slideDB.addSlideNodeVariant(slideNode, request.payload, userId).then((newVariant) => {
                        // also create a thumbnail
                        let newSlideId = util.toIdentifier(newVariant);
                        // content is the same as the primary slide
                        fileService.createThumbnail(slideNode.slide.content, newSlideId, slideNode.parent.theme).catch((err) => {
                            console.warn(`could not create thumbnail for new slide variant ${newSlideId}, error was: ${err.message}`);
                        });

                        return newVariant;
                    });
                });
            });

        }).then((result) => {
            // after all is said and done, reply!
            reply(result);
        }).catch((err) => {
            if (err.isBoom) return reply(err);

            request.log('error', err);
            reply(boom.badImplementation());
        });

    },

    //gets a flat listing of the slides from deck and all of its sub-decks with optional offset and limit
    getFlatSlides: function(request, reply){
        treeDB.getFlatSlides(request.params.id, _.pick(request.query, 'language'))
        .then((deckTree) => {
            if (co.isEmpty(deckTree)){
                return reply(boom.notFound());
            }
            if(typeof request.query.limit !== 'undefined' || typeof request.query.offset !== 'undefined'){
                let limit = request.query.limit, offset = request.query.offset;
                if(typeof limit !== 'undefined'){
                    limit = parseInt(limit);
                    if(limit < 0 || limit > deckTree.children.length || isNaN(limit))
                        limit = deckTree.children.length;
                }
                else{
                    limit = deckTree.children.length;
                }

                if(typeof offset !== 'undefined'){
                    offset = parseInt(offset);
                    if(offset < 0 || offset >= deckTree.children.length)
                        offset = 0;
                }
                else{
                    offset = 0;
                }

                let ending = parseInt(offset)+parseInt(limit);
                deckTree.children = deckTree.children.slice(offset, ending);
            }

            if(request.query.countOnly){
                reply({slidesCount: deckTree.children.length});
            } else {
                deckTree.slidesCount = deckTree.children.length;
                reply(deckTree);
            }
        }).catch((err) => {
            request.log('error', err);
            reply(boom.badImplementation());
        });

    },

    // returns the users and groups authorized for editing the deck
    getEditors: function(request, reply){
        let deckId = request.params.id;

        deckDB.get(deckId).then((deck) => {
            if (!deck) return reply(boom.notFound());

            let {users, groups} = deck.editors || {};
            if (!users) users = [];
            if (!groups) groups = [];

            reply({ editors: {users, groups} });

        }).catch((err) => {
            request.log('error', err);
            reply(boom.badImplementation());
        });

    },

    replaceEditors: function(request, reply) {
        let deckId = request.params.id;
        let userId = request.auth.credentials.userid;

        deckDB.get(deckId).then((deck) => {
            if(!deck)   return reply(boom.notFound());

            // permit deck owner only to use this
            if (userId !== deck.user) return reply(boom.forbidden());

            // TODO for now all subdecks should have the same owner, so no further authorization required
            return deckDB.deepReplaceEditors(deckId, request.payload).then(() => reply());

        }).catch((err) => {
            request.log('error', err);
            reply(boom.badImplementation());
        });

    },

    requestEditRights: function(request, reply) {
        let deckId = request.params.id;
        let userId = request.auth.credentials.userid;

        deckDB.userPermissions(deckId, userId).then((perm) => {
            if (!perm) throw boom.notFound();

            if (perm.edit) {
                // user already has permissions, return error
                throw boom.badData();
            }

            return deckDB.addEditRightsRequest(deckId, userId);

        }).then(reply).catch((err) => {
            if (err.isBoom) return reply(err);
            request.log('error', err);
            reply(boom.badImplementation());
        });
    },

    userPermissions: function(request, reply) {
        let deckId = request.params.id;
        let userId = request.auth.credentials.userid;

        deckDB.userPermissions(deckId, userId).then((perm) => {
            if (!perm) return reply(boom.notFound());

            reply(perm);
        }).catch((err) => {
            request.log('error', err);
            reply(boom.badImplementation(err));
        });

    },

    //gets all recent decks
    getAllRecent: (request, reply) => {
        let limit = parseInt(request.params.limit);
        let offset = parseInt(request.params.offset);

        deckDB.getAllRecent(limit, offset).then( (recentDecks) => {
            if(!recentDecks) return reply([]);

            let userIds = new Set(), countForksIds = new Set();

            // collect user ids and deck ids to count forks needed
            recentDecks.forEach( (deck) => {
                userIds.add(deck.user);
                countForksIds.add(deck._id);
            });

            // count deck forks for the abouve deck ids
            let forkCounts = {};
            let forkCountsPromise = deckDB.countManyDeckForks([...countForksIds]).then( (forkCountsInfo) => {
                forkCountsInfo.forEach( (forkCount) => {
                    forkCounts[forkCount._id] = forkCount.forkCount;
                });
            });

            // fetch usernames for user ids needed
            let usernames = {};
            let userPromise = userService.fetchUserInfo([...userIds]).then( (userInfo) => {
                userInfo.forEach( (u) => {
                    usernames[u.id] = u.username;
                });
            });

            return Promise.all([userPromise, forkCountsPromise]).then( () => {

                recentDecks = recentDecks.map( (deck) => {

                    // get active revision
                    let activeRevision = deck.revisions.find((rev) => (rev.id === deck.active));
                    if(!activeRevision) return null;

                    // get latest revision
                    let [latestRevision] = deck.revisions.slice(-1);

                    return {
                        _id: deck._id,
                        title: activeRevision.title,
                        description: deck.description,
                        user: deck.user,
                        username: (usernames[deck.user]) ? usernames[deck.user] : 'Unknown user',
                        active: deck.active,
                        countRevisions: deck.revisions.length,
                        timestamp: deck.timestamp,
                        language: (activeRevision.language) ? activeRevision.language.substring(0, 2) : 'en',
                        forkCount: (forkCounts[deck._id]) ? forkCounts[deck._id] : 0,
                        theme: activeRevision.theme,
                        firstSlide: deckDB.getFirstSlide(activeRevision),
                        revisionId: activeRevision.id,
                        latestRevisionId: latestRevision.id
                    };
                }).filter( (deck) => { return deck != null; });

                reply(recentDecks);

            }).catch( (err) => {
                request.log('error', err);
                reply(boom.badImplementation());
            });
        }).catch( (err) => {
            request.log('error', err);
            reply(boom.badImplementation());
        });
    },

    //gets all featured decks
    getAllFeatured: (request, reply) => {
        let limit = parseInt(request.params.limit);
        let offset = parseInt(request.params.offset);

        deckDB.getAllFeatured(limit, offset).then( (featuredDecks) => {
            if(!featuredDecks) return reply([]);

            let userIds = new Set(), countForksIds = new Set();

            // collect user ids and deck ids to count forks needed
            featuredDecks.forEach( (deck) => {
                userIds.add(deck.user);
                countForksIds.add(deck._id);
            });

            // count deck forks for the abouve deck ids
            let forkCounts = {};
            let forkCountsPromise = deckDB.countManyDeckForks([...countForksIds]).then( (forkCountsInfo) => {
                forkCountsInfo.forEach( (forkCount) => {
                    forkCounts[forkCount._id] = forkCount.forkCount;
                });
            });

            // fetch usernames for user ids needed
            let usernames = {};
            let userPromise = userService.fetchUserInfo([...userIds]).then( (userInfo) => {
                userInfo.forEach( (u) => {
                    usernames[u.id] = u.username;
                });
            });

            return Promise.all([userPromise, forkCountsPromise]).then( () => {
                featuredDecks = featuredDecks.map( (deck) => {

                    // get active revision
                    let activeRevision = deck.revisions.find((rev) => (rev.id === deck.active));
                    if(!activeRevision) return null;

                    // get latest revision
                    let [latestRevision] = deck.revisions.slice(-1);

                    return {
                        _id: deck._id,
                        title: activeRevision.title,
                        description: deck.description,
                        user: deck.user,
                        username: (usernames[deck.user]) ? usernames[deck.user] : 'Unknown user',
                        active: deck.active,
                        countRevisions: deck.revisions.length,
                        timestamp: deck.timestamp,
                        language: (activeRevision.language) ? activeRevision.language.substring(0, 2) : 'en',
                        forkCount: (forkCounts[deck._id]) ? forkCounts[deck._id] : 0,
                        theme: activeRevision.theme,
                        firstSlide: deckDB.getFirstSlide(activeRevision),
                        revisionId: activeRevision.id,
                        latestRevisionId: latestRevision.id
                    };
                });

                reply(featuredDecks);
            });
        }).catch( (err) => {
            request.log('error', err);
            reply(boom.badImplementation());
        });
    },

    //returns metadata about all decks a user owns
    getAllDecks: (request, reply) => {
        //TODO another API for user activity is needed

        //parse userid
        let userid = request.params.userid;
        const integerSchema = Joi.number().integer();
        const validationResult = integerSchema.validate(userid);
        if (validationResult.error === null) {
            userid = validationResult.value;
        }

        let decksPromise = deckDB.find('decks', {
            user: userid,
            hidden: { $in: [false, null] },
        });

        decksPromise.then((decks) => {
            let result = [];

            decks.forEach((deck) => {
                let metadata = {};
                metadata._id = deck._id;
                metadata.timestamp = deck.timestamp;
                metadata.description = deck.description;
                metadata.lastUpdate = deck.lastUpdate;
                metadata.tags = deck.tags;
                metadata.translation = deck.translation;
                metadata.countRevisions = deck.revisions.length;
                metadata.active = deck.active;

                //get revision
                let revision = {};
                for (let key in deck.revisions) {
                    if (deck.revisions[key].id === deck.active)
                        revision = deck.revisions[key];
                }

                metadata.title = revision.title;
                metadata.comment = revision.comment;
                metadata.abstract = revision.abstract;
                metadata.license = revision.license;
                metadata.priority = revision.priority;
                metadata.visibility = revision.visibility;
                if (revision.language){
                    metadata.language = revision.language.length === 2 ? revision.language : revision.language.substring(0, 2);
                }else{
                    metadata.language = 'en';
                }
                metadata.translation = revision.translation;
                metadata.tags = revision.tags;
                metadata.parent = revision.parent;
                metadata.theme = revision.theme;

                // get first slide
                metadata.firstSlide = deckDB.getFirstSlide(revision);

                result.push(metadata);
            });

            return reply(result);

        }).catch((err) => {
            request.log('error', err);
            reply(boom.badImplementation());
        });
    },

    //counts the revisions of a given deck
    countDeckRevisions: function(request, reply){
        deckDB.get(request.params.id.split('-')[0]).then((foundDeck) => {
            if(!foundDeck){
                reply(boom.notFound());
            }
            else{
                reply(foundDeck.revisions.length);
            }
        }).catch((err) => {
            request.log('error', err);
            reply(boom.badImplementation());
        });
    },

    //counts the slide revisions of a given slide
    countSlideRevisions: function(request, reply){
        slideDB.get(request.params.id.split('-')[0]).then((foundSlide) => {
            if(!foundSlide){
                reply(boom.notFound());
            }
            else{
                reply(foundSlide.revisions.length);
            }
        }).catch((err) => {
            request.log('error', err);
            reply(boom.badImplementation());
        });
    },

    getDeckUsage: function(request, reply) {
        let deckId = request.params.id;
        let deck = util.parseIdentifier(deckId);
        deckDB.get(deck.id).then((existingDeck) => {
            if (!existingDeck) throw boom.notFound();

            return deckDB.getUsage(deckId);

            /* eslint-disable no-unreachable */
            // TODO dead code
            return deckDB.getRootDecks(deckId)
            .then((roots) => {
                return roots;
                // TODO dead code
                return Promise.all(roots.map((r) => {
                    return deckDB.findPath(util.toIdentifier(r), deckId)
                    .then((path) => {
                        let [leaf] = path.slice(-1);
                        leaf.id = deck.id;
                        leaf.revision = deck.revision || r.using;
                        return path;
                    });
                })).then((paths) => paths.map(util.toPlatformPath));
            });
            /* eslint-enable no-unreachable */
        }).then(reply).catch((err) => {
            if (err.isBoom) return reply(err);
            request.log('error', err);
            reply(boom.badImplementation());
        });

    },

    getDeckRootDecks: function(request, reply){
        let deckId = request.params.id;
        let deck = util.parseIdentifier(deckId) || {};
        deckDB.get(deck.id).then((existingDeck) => {
            if (!existingDeck) throw boom.notFound();

            return deckDB.getRootDecks(deckId)
            .then((roots) => {
                return roots;
                /* eslint-disable no-unreachable */
                // TODO dead code
                return Promise.all(roots.map((r) => {
                    return deckDB.findPath(util.toIdentifier(r), deckId)
                    .then((path) => {
                        let [leaf] = path.slice(-1);
                        leaf.id = deck.id;
                        leaf.revision = deck.revision || r.using;
                        return path;
                    });
                })).then((paths) => paths.map(util.toPlatformPath));
                /* eslint-enable no-unreachable */
            });

        }).then(reply).catch((err) => {
            if (err.isBoom) return reply(err);
            request.log('error', err);
            reply(boom.badImplementation());
        });
    },

    getSlideUsage: function(request, reply) {
        let slideId = request.params.id;
        let slide = util.parseIdentifier(slideId);
        slideDB.get(slide.id).then((existingSlide) => {
            if (!existingSlide) throw boom.notFound();

            return deckDB.getUsage(slideId, 'slide');

            /* eslint-disable no-unreachable */
            // TODO dead code
            return deckDB.getRootDecks(slideId, 'slide').then((roots) => {
                return roots;
                // TODO dead code
                return Promise.all(roots.map((r) => {
                    // path method does not return the slide id, so we take it from the root
                    return deckDB.findPath(util.toIdentifier(r), slideId, 'slide')
                    .then((path) => {
                        let [leaf] = path.slice(-1);
                        leaf.id = slide.id;
                        leaf.revision = slide.revision || r.using;
                        leaf.kind = 'slide';

                        return path;
                    });
                })).then((paths) => paths.map(util.toPlatformPath));

            });
            /* eslint-enable no-unreachable */
        }).then(reply).catch((err) => {
            if (err.isBoom) return reply(err);
            request.log('error', err);
            reply(boom.badImplementation());
        });

    },

    getSlideRootDecks: function(request, reply){
        let slideId = request.params.id;
        let slide = util.parseIdentifier(slideId);
        slideDB.get(slide.id).then((existingSlide) => {
            if (!existingSlide) throw boom.notFound();

            return deckDB.getRootDecks(slideId, 'slide').then((roots) => {
                return roots;
                /* eslint-disable no-unreachable */
                // TODO dead code
                return Promise.all(roots.map((r) => {
                    // path method does not return the slide id, so we take it from the root
                    return deckDB.findPath(util.toIdentifier(r), slideId, 'slide')
                    .then((path) => {
                        let [leaf] = path.slice(-1);
                        leaf.id = slide.id;
                        leaf.revision = slide.revision || r.using;
                        leaf.kind = 'slide';

                        return path;
                    });
                })).then((paths) => paths.map(util.toPlatformPath));
                /* eslint-disable no-unreachable */

            });
        }).then(reply).catch((err) => {
            if (err.isBoom) return reply(err);
            request.log('error', err);
            reply(boom.badImplementation());
        });
    },

    getDeckTags: function(request, reply){
        deckDB.getTags(request.params.id).then( (tagsList) => {
            if(!tagsList){
                reply(boom.notFound());
            }
            else{
                reply(tagsList);
            }
        }).catch( (err) => {
            request.log(err);
            reply(boom.badImplementation());
        });
    },

    updateDeckTags: function(request, reply) {
        let userId = request.auth.credentials.userid;
        let operation = (request.payload.operation === 'add') ? deckDB.addTag.bind(deckDB) : deckDB.removeTag.bind(deckDB);

        operation(request.params.id, request.payload.tag).then( (tagsList) => {
            if(!tagsList){
                reply(boom.notFound());
            }
            else{
                // send tags to tag-service
                if(tagsList && tagsList.length > 0){
                    tagService.upload(tagsList, userId).catch( (e) => {
                        request.log('warning', 'Could not save tags to tag-service for deck ' + request.params.id + ': ' + e.message);
                    });
                }

                reply(tagsList);
            }
        }).catch((error) => {
            request.log('error', error);
            reply(boom.badImplementation());
        });
    },

    replaceDeckTags: function(request, reply) {
        let userId = request.auth.credentials.userid;

        let deckId = request.params.id;
        let rootDeckId = request.payload.top_root_deck;

        auth.authorizeUser(userId, deckId, rootDeckId).then((boomError) => {
            if (boomError) throw boomError;

            return deckDB.get(deckId).then( (deck) => {
                if(!deck) throw boom.notFound();

                return deckDB.replaceTags(deckId, request.payload.tags, userId, rootDeckId).then((updatedDeck) => {
                    return updatedDeck;
                });
            });
        }).then(reply).catch((err) => {
            if (err.isBoom) return reply(err);
            request.log('error', err);
            reply(boom.badImplementation());
        });

    },

    getSlideTags: function(request, reply){
        slideDB.getTags(request.params.id).then( (tagsList) => {
            if(!tagsList){
                reply(boom.notFound());
            }
            else{
                reply(tagsList);
            }
        }).catch( (err) => {
            request.log(err);
            reply(boom.badImplementation());
        });
    },

    updateSlideTags: function(request, reply) {
        let userId = request.auth.credentials.userid;
        let operation = (request.payload.operation === 'add') ? slideDB.addTag.bind(slideDB) : slideDB.removeTag.bind(slideDB);

        operation(request.params.id, request.payload.tag).then( (tagsList) => {
            if(!tagsList){
                reply(boom.notFound());
            }
            else{
                // send tags to tag-service
                if(tagsList && tagsList.length > 0){
                    tagService.upload(tagsList, userId).catch( (e) => {
                        request.log('warning', 'Could not save tags to tag-service for slide ' + request.params.id + ': ' + e.message);
                    });
                }

                reply(tagsList);
            }
        }).catch((error) => {
            request.log('error', error);
            reply(boom.badImplementation());
        });
    },

    getDeckMedia: function(request, reply){
        deckDB.getMedia(request.params.id, request.query.mediaType).then( (deckMedia) => {
            if(!deckMedia){
                reply(boom.notFound());
            }
            else{
                reply(deckMedia);
            }
        }).catch( (error) => {
            request.log('error', error);
            reply(boom.badImplementation());
        });
    },

    getDeckDeepUsage: function(request, reply){
        let deckId = request.params.id;

        deckDB.get(deckId).then( (deck) => {
            if(!deck)   return reply(boom.notFound());

            return deckDB.getDeepUsage(deckId, 'deck', request.query.keepVisibleOnly).then( (usage) => {
                if(!usage){
                    reply(boom.notFound());
                } else {
                    reply(usage);
                }
            });
        }).catch( (err) => {
            request.log('error', err);
            reply(boom.badImplementation());
        });
    },

    getSlideDeepUsage: function(request, reply){
        let slideId = request.params.id;

        slideDB.exists(slideId).then( (exists) => {
            if(!exists) return reply(boom.notFound());

            return deckDB.getDeepUsage(slideId, 'slide', request.query.keepVisibleOnly).then( (usage) => {
                if(!usage){
                    reply(boom.notFound());
                } else {
                    reply(usage);
                }
            });
        }).catch( (err) => {
            request.log('error', err);
            reply(boom.badImplementation());
        });
    },

    getForkGroup: function(request, reply){
        deckDB.computeForkGroup(request.params.id).then( (forkGroup) => {
            if(_.isEmpty(forkGroup)){
                reply(boom.notFound());
            } else {
                reply(forkGroup);
            }
        }).catch( (err) => {
            request.log('error', err);
            reply(boom.badImplementation());
        });
    },

    regenThumbnails: function(request, reply) {
        let deckId = request.params.id;

        deckDB.getFlatSlides(deckId).then((deckTree) => {
            if (!deckTree) return reply(boom.notFound());

            async.concatSeries(deckTree.children, (slide, done) => {
                if (!slide.content) {
                    slide.content = `<h2>${slide.title}</h2>`;
                }

                fileService.createThumbnail(slide.content, slide.id, slide.theme, request.query.force).then(() => {
                    done(null, { id: slide.id, status: 'OK' });
                }).catch((err) => {
                    done(null, { id: slide.id, status: err.message });
                });
            }, (err, results) => {
                if (err) {
                    request.log('error', err);
                    reply(boom.badImplementation());
                } else {
                    reply(results);
                }
            });

        }).catch((err) => {
            request.log('error', err);
            reply(boom.badImplementation());
        });

    },

};

// TODO move these to services / utility libs

// reusable method that authorizes user for editing a deck given the deck tree root deck
function authorizeUser(userId, deckId, rootDeckId) {
    let permissionChecks = _.uniq([deckId, rootDeckId])
    .map((id) => deckDB.userPermissions(id, userId));

    return Promise.all(permissionChecks).then((perms) => {
        // return 404 for deckId missing as it's on the path
        if (!perms[0]) return boom.notFound();

        // if others are not found return 422 instead of 404 (not part of path)
        if (perms.some((p) => p === undefined)) return boom.badData(`could not authorize user:${userId} for deck:${deckId} under tree:${rootDeckId}`);

        // check edit permission
        if (perms.some((p) => !p.edit)) return boom.forbidden();

        // check readOnly status
        if (perms.some((p) => p.readOnly)) return boom.forbidden();

        // return nothing if all's ok :)
    });

}
