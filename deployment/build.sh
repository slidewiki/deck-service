#!/bin/bash

docker build -t slidewiki/deckservice ./
docker rmi $(docker images | grep "<none>" | awk "{print \$3}")
docker push slidewiki/deckservice
