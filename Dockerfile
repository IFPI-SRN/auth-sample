FROM node:20.12.0 AS development

USER root

# set our node environment, either development or production
# defaults to production, compose overrides this to development on build and run
ARG NODE_ENV=production
ENV NODE_ENV $NODE_ENV

WORKDIR /app

# default to port 8000 for node
ARG PORT=8001
ENV PORT $PORT
EXPOSE $PORT

COPY package.json .
COPY package-lock.json .
RUN npm ci --silent

# copy in our source code last, as it changes the most
COPY --chown=root:root . .

CMD [ "npm", "start" ]
