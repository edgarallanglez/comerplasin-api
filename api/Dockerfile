FROM node:20-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY index.js ./
ENV PORT=3001
EXPOSE 3001
CMD ["node", "index.js"]
