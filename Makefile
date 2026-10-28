.PHONY: test deploy

deploy: data/zips.txt
	scp -r index.html style.css js data ${DEPLOY_USER}@${DEPLOY_HOST}:/home/public/daylight

data/zips.txt:
	python3 scripts/build-zips.py
