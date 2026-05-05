FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm install -g tsx
EXPOSE 3005
CMD ["tsx", "src/index.ts"]
