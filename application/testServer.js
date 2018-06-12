'use strict';

const hapi = require('hapi');
const helper = require('./database/helper');

module.exports = function(secret) {

    return new Promise((resolve, reject) => {
        let server = new hapi.Server();

        server.connection({
            host: 'localhost',
            port: 3030,
        });

        server.register([require('hapi-auth-jwt2')], (err) => {
            if (err) return reject(err);

            server.auth.strategy('jwt', 'jwt', {
                key: secret,
                validateFunc: (decoded, request, callback) => {callback(null, true);},
                verifyOptions: {
                    ignoreExpiration: true
                },
                headerKey: '----jwt----',
            });

            require('./routes.js')(server);

            // graceful shutdown
            server.on({
                name: 'stop',
                block: true,
            }, (payload, done) => {
                // clean up database connections
                helper.closeConnection().catch((err) => {
                    console.warn('error while closing db connections: ', err);
                }).then(() => done());
            });

            // clean up database when first starting the server
            resolve(helper.cleanDatabase().then(() => server));
        });

    });

};
