FROM node:22-alpine

WORKDIR /app

COPY .output .output

ENV PORT=3000
EXPOSE 3000

CMD ["node", ".output/server/index.mjs"]
