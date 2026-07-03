FROM alpine:latest
RUN apk add --no-cache socat
EXPOSE 8888
CMD ["sh", "-c", "socat TCP-LISTEN:8888,fork,reuseaddr TCP:wonderful-laughter.railway.internal:8888"]
