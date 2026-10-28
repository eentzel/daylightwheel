.PHONY: deploy serve

deploy:
	scp -r index.html style.css js data ${DEPLOY_USER}@${DEPLOY_HOST}:/home/public/daylight

serve:
	python3 -m http.server

data/zips.txt:
	python3 scripts/build-zips.py
