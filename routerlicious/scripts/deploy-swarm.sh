eval $(docker-machine env prague-manager-1)
docker login -u $0 -p $1 prague.azurecr.io
docker-compose -f docker-compose.yml -f docker-compose.prod.yml config > docker-compose.prod.full.yml
docker stack deploy --compose-file docker-compose.prod.full.yml --with-registry-auth routerlicious
