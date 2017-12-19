'use strict';

//const helper = require('../../database/helper.js');

const deckDB = require('../../database/deckDatabase.js');


let self = module.exports = (agenda) => {
    if (agenda){
        agenda.define('translation', (job, done) => {
            deckDB.translateDeckRevision(job.attrs.data.deckId, job.attrs.data.userId, job.attrs.data.language)
            .then((id_map) => {
                console.log(id_map);
                done();
            })
            .catch((err) => {
                done(err);
            });
        });
    }else{
        throw('Agenda listener was not created');
    }

};


// let self = module.exports = {
//     addDeckTranslation: function(agenda){
//            run(agenda, data).catch(error => {
//                console.error(error);
//                process.exit(-1);
//            });
//     }
// };
//
// let run = async function(agenda, data) => {
//     console.log('Entering the queue');
//     // let db = await helper.connectToDatabase();
//     // const agenda = new Agenda().mongo(db, 'jobs');
//     agenda.define('translation', async(job) => {
//         let id_map = await deckDB.translateDeckRevision(job.attrs.data.deckId, job.attrs.data.userId, job.attrs.data.language);
//         console.log(id_map);
//     });
//
//
//     //
//
//     // agenda.start();
// }
