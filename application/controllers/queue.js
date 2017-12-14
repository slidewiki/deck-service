'use strict';

const Agenda = require('agenda');
const helper = require('../database/helper');

const deckDB = require('../database/deckDatabase.js');


let self = module.exports = {
    addDeckTranslation: (deckId, userId, language) => {
           run({deckId, userId, language}).catch(error => {
               console.error(error);
               process.exit(-1);
           });
    }
};

const run = async(data) => {
    console.log('Entering the queue');
    let db = await helper.connectToDatabase();
    const agenda = new Agenda().mongo(db, 'translation_jobs');
    agenda.define('translation', async(job) => {
        let id_map = await deckDB.translateDeckRevision(job.attrs.data.deckId, job.attrs.data.userId, job.attrs.data.language);
        console.log(id_map);
    });

    await new Promise(resolve => agenda.once('ready', resolve));

    agenda.schedule(new Date(Date.now() + 1000), 'translation', data);
    agenda.start();
}
