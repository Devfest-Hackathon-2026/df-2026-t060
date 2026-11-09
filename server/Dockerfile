# 先生の側のAIサーバー(server/index.js)を、Cloud Run に載せるためのコンテナ。
# AI(Gemma)そのものは入っていない。別のコンテナ(deploy/cloudrun/Dockerfile.ollama の Ollama)に http://127.0.0.1:11434 でつなぐ。
#
# ビルドは、リポジトリのいちばん上のフォルダから(server/ と public/js/ の両方が要るため):
#   gcloud builds submit --config deploy/cloudrun/cloudbuild-app.yaml --substitutions _IMAGE=REGION-docker.pkg.dev/PROJECT/kyozai/app:latest .
#   (手元に Docker があれば)docker build -f server/Dockerfile -t kyozai-app .
#
# Node 24:AIが書いたプログラムを閉じた場所(--permission)で動かすので、権限モデルが使える版にする(22.13 以上)。
FROM node:24-slim

WORKDIR /app
ENV NODE_ENV=production

# 先に依存だけ入れる(ソースを変えても、ここはキャッシュが効く)
COPY server/package.json server/package-lock.json server/
RUN cd server && npm ci --omit=dev

# サーバー本体と、計算の部品(server/ は ../public/js/ を読む)。.dockerignore で、要らないものは除いてある
COPY server server
COPY public/js public/js

# Cloud Run は PORT を渡す(8080)。AIは、同じ場所(localhost)の Ollama に向ける
ENV PORT=8080 \
    LLM_BASE_URL=http://127.0.0.1:11434 \
    LLM_MODEL=gemma4:12b \
    FIREBASE_PROJECT=kyoiku-hakkason

# 使えるのは、Google ログインの先生だけ。さらに、使える先生を決めるなら、デプロイのときに
#   TEACHER_EMAILS / TEACHER_DOMAINS(deploy/cloudrun/service.yaml)を設定する
# 保存するデータ(AIが作ったシミュレーションなど)は、Cloud Run では止まると消える。残すなら、
#   Cloud Storage をマウントして GEN_LIBRARY_DIR などを向ける(docs/cloudrun.md)
RUN mkdir -p /tmp/kyozai && chown -R node:node /app /tmp/kyozai
USER node

EXPOSE 8080
CMD ["node", "server/index.js"]
