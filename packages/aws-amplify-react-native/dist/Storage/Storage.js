/*
 * Copyright 2017-2017 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"). You may not use this file except in compliance with
 * the License. A copy of the License is located at
 *
 *     http://aws.amazon.com/apache2.0/
 *
 * or in the "license" file accompanying this file. This file is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR
 * CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions
 * and limitations under the License.
 */

import { AWS, ConsoleLogger as Logger, Constants } from '../Common';

import Auth from '../Auth';

const logger = new Logger('StorageClass');

const { S3 } = AWS;

/**
 * Provide storage methods to use AWS S3
 */
class StorageClass {
    /**
     * @param {Object} config - Configuration of the Storage
     */
    constructor(config) {
        this.configure(config);
    }

    /**
     * Configure Storage part with aws configuration
     * @param {Object} config - Configuration of the Storage
     * @return {Object} - Current configuration 
     */
    configure(config) {
        logger.debug('configure Storage');
        let conf = config ? config.Storage || config : {};

        if (conf['aws_user_files_s3_bucket']) {
            conf = {
                bucket: config['aws_user_files_s3_bucket'],
                region: config['aws_user_files_s3_bucket_region']
            };
        }

        this._config = Object.assign({}, this._config, conf);

        return this._config;
    }

    /**
    * Get a presigned URL of the file
    * @param {String} key - key of the object
    * @param {Object} [options] - { level : private|public }
    * @return {Promise} - A promise resolves to Amazon S3 presigned URL on success
    */
    async get(key, options) {
        const { bucket, region } = this._config;
        if (!bucket) {
            Promise.reject('No bucket in config');
        }

        const credentialsOK = await this._ensureCredentials();
        if (!credentialsOK) {
            return Promise.reject('No credentials');
        }

        const opt = Object.assign({}, this._config, options);
        const prefix = this._prefix(opt);
        const path = prefix + key;
        logger.debug('get ' + key + ' from ' + path);

        const s3 = this._createS3();
        const params = {
            Bucket: bucket,
            Key: path
        };

        return new Promise((resolve, reject) => {
            try {
                const url = s3.getSignedUrl('getObject', params);
                logger.debug('url is ' + url);
                resolve(url);
            } catch (e) {
                logger.error('get error', e);
                reject(e);
            }
        });
    }

    /**
     * Put a file in S3 bucket specified to configure method
     * @param {Stirng} key - key of the object
     * @param {Object} object - File to be put in Amazon S3 bucket
     * @param {Object} options - { level : private|public, contentType: MIME Types }
     * @return {Promise} - promise resolves to object on success
     */
    async put(key, obj, options) {
        logger.debug('put ' + path);
        const { bucket, region } = this._config;
        if (!bucket) {
            Promise.reject('No bucket in config');
        }

        const credentialsOK = await this._ensureCredentials();
        if (!credentialsOK) {
            return Promise.reject('No credentials');
        }

        const opt = Object.assign({}, this._config, options);
        const contentType = opt.contentType || 'binary/octet-stream';
        const prefix = this._prefix(opt);
        const path = prefix + key;
        logger.debug('put on to ' + path, this._config.credentials);

        const s3 = this._createS3();
        const params = {
            Bucket: bucket,
            Key: path,
            Body: obj,
            ContentType: contentType
        };

        return new Promise((resolve, reject) => {
            s3.upload(params, (err, data) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(data);
                }
            });
        });
    }

    /**
     * Remove the object for specified key
     * @param {String} key - key of the object
     * @param {Object} [options] - { level : private|public }
     * @return {Promise} - Promise resolves upon successful removal of the object
     */
    async remove(key, options) {
        const { bucket, region } = this._config;
        if (!bucket) {
            Promise.reject('No bucket in config');
        }

        const credentialsOK = await this._ensureCredentials();
        if (!credentialsOK) {
            return Promise.reject('No credentials');
        }

        const opt = Object.assign({}, this._config, options);
        const prefix = this._prefix(opt);
        const path = prefix + key;

        const s3 = this._createS3();
        const params = {
            Bucket: bucket,
            Key: path
        };

        return new Promise((resolve, reject) => {
            s3.deleteObject(params, function (err, data) {
                if (err) {
                    reject(err);
                } else {
                    resolve(data);
                }
            });
        });
    }

    /**
     * List bucket objects relative to the level and prefix specified
     * @param {String} path - the path that contains objects
     * @param {Object} [options] - { level : private|public }
     * @return {Promise} - Promise resolves to list of keys for all objects in path
     */
    async list(path, options) {
        const { bucket, region } = this._config;
        if (!bucket) {
            Promise.reject('No bucket in config');
        }

        const credentialsOK = await this._ensureCredentials();
        if (!credentialsOK) {
            return Promise.reject('No credentials');
        }

        const opt = Object.assign({}, this._config, options);
        const prefix = this._prefix(opt);
        path = prefix + path;

        const s3 = this._createS3();
        const params = {
            Bucket: bucket,
            Prefix: path
        };

        return new Promise((resolve, reject) => {
            s3.listObjects(params, function (err, data) {
                if (err) {
                    reject(err);
                } else {
                    const list = data.Contents.map(item => {
                        return {
                            key: item.Key.substr(prefix.length),
                            eTag: item.ETag,
                            lastModified: item.LastModified,
                            size: item.Size
                        };
                    });
                    resolve(list);
                }
            });
        });
    }

    /**
     * @private
     */
    _ensureCredentials() {
        const conf = this._config;
        if (conf.credentials) {
            return Promise.resolve(true);
        }

        return Auth.currentCredentials().then(credentials => {
            const cred = Auth.essentialCredentials(credentials);
            logger.debug('set credentials for storage', cred);
            conf.credentials = cred;
            this._setAWSConfig();

            return true;
        }).catch(err => {
            logger.error('ensure credentials error', err);
            return false;
        });
    }

    /**
     * @private
     */
    _setAWSConfig() {
        if (AWS.config) {
            AWS.config.update({
                region: this._config.region,
                credentials: this._config.credentials
            });
        }
    }

    /**
     * @private
     */
    _prefix(options) {
        const opt = Object.assign({}, { level: 'public' }, options);
        const { level } = opt;
        const { identityId, authenticated } = this._config.credentials;
        return level === 'private' ? `private/${identityId}/` : 'public/';
    }

    /**
     * @private
     */
    _createS3() {
        const { region, bucket } = this._config;
        return new S3({
            apiVersion: '2006-03-01',
            bucket: { Bucket: bucket },
            region: region
        });
    }

    /**
     * @private
     */
    _base64ToArrayBuffer(base64) {
        const binary_string = atob(base64);
        const len = binary_string.length;
        const bytes = new Uint8Array(len);
        for (var i = 0; i < len; i++) {
            bytes[i] = binary_string.charCodeAt(i);
        }
        return bytes.buffer;
    }
}

export default StorageClass;