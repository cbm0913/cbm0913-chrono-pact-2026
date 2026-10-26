FROM node:20-alpine

WORKDIR /app

COPY package.json server.js index.html pvp.html ./

ENV PORT=8787
EXPOSE 8787

CMD ["npm", "start"]
