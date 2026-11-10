FROM node:24-alpine
WORKDIR /app

COPY package.json ./
COPY server ./server
COPY public ./public
RUN mkdir -p /app/data/uploads

ENV NODE_ENV=production
ENV PORT=3456
ENV FENIX_DATA_DIR=/app/data

EXPOSE 3456

CMD ["node", "server/index.js"]
