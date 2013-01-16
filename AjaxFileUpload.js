
(function(global) {
	var className = 'FileUpload';
	global = global || window;

	// features needed for job
	var features = ['FormData', 'File', 'FileReader', 'XMLHttpRequestUpload', 'Blob'],
		missing = [];

	// compatibility check
	for (var i = 0, max = features.length; i < max; i += 1) {
		if (typeof(window[features[i]]) == 'undefined') {
			missing.push(features[i]);
		}
	}

	if (missing.length > 0) {
		var msg = className + " won't work - there are missing features: " + missing.join(', ');

		// bailout
		alert(msg);
		throw new Error(msg);
	}

	//
	// Exposed class
	//

	//
	// constructor
	//
	// @param Object config with possible properties:
	//
	// @cfg string url - (required) url to which file upload will happen
	// @cfg File file - (required) valid file object
	// @cfg Object listeners - event callbacks:
	//		@callback chunkprogress(self, chunkId, complete, e)
	//			@desc called on every chunk progress change
	//			@param this self - FileUpload object reference
	//			@param int chunkId - chunk id
	//			@param float complete - percentage value
	//			@param Event e - raw event object
	//
	//		@callback progress(self, complete, loaded)
	//			@desc called on chunk upload complete, it is whole upload progress event
	//			@param this self - FileUpload object reference
	//			@param float complete - percentage value
	//			@param int loaded - loaded chunks count
	//
	//		@callback error(e)
	//			@desc called when ajax fails
	//			@param Event e - raw xhr event object
	//
	//		@callback abort(e)
	//			@desc called when ajax is being aborted
	//			@param Event e - raw xhr event object
	//
	//		@callback upload(self, time, responseText, e)
	//			@desc called when whole upload operation is finished
	//			@param this self - FileUpload object reference
	//			@param int time - calculated duration in miliseconds
	//			@parma Event - raw xhr event object
	//
	//		@callback finish(self, time, chunksLoaded, e)
	//			@desc called when there is no more chunks for upload. It can be called when
	//					some chunks did not uploaded successfuly
	//			@param this self - FileUpload object reference
	//			@param int time - calculated duration in miliseconds
	//			@param int chunksLoaded - successfuly loaded chunks count
	//			@param Event e - raw xhr event object
	//
	//		@callback chunkupload(self, chunkId, loaded, responseText, e)
	//			@desc called when chunk upload is finished
	//			@param this self - FileUpload object reference
	//			@param int chunkId - chunk id
	//			@param int loaded - loaded chunks count including this one
	//			@param string responseText - response text from server
	//			@param Event e - raw xhr event object
	//
	//		@callback beforechunkupload(self, chunkId, fd, xhr, isLast)
	//			@desc called before chunk upload. With provided xhr and fd you can
	//					do all nasty things
	//			@param this self - FileUpload object reference
	//			@param int chunkId - chunk id
	//			@param FormData fd - form data being sent to host. It's already populated
	//									with necessary params
	//			@param XMLHttpRequest xhr - XHR handle <rude-comment>that's right, bitch - no IE for a while</rude-comment>
	//			@param boolean isLast - true if it's last chunk being to be uploaded
	//
	//		@callback cancel(self)
	//			@desc called when upload is being canceled
	//			@param this self - FileUpload object reference
	//
	//		@callback httperror(self, chunkId, status, e)
	//			@desc called when http response status is not 200 OK
	//			@param this self - FileUpload object reference
	//			@param int chunkId - chunk id
	//			@param int status - status code (i.e. 500)
	//			@param Event e - raw xhr event object
	//
	//		@callback jsonerror(self, chunkId, json, e)
	//			@desc called when json with success property from response contains falsy value
	//			@param this self - FileUpload object reference
	//			@param int chunkId - chunk id
	//			@param Object json - parsed json object. If it is not valid json text, null goes here
	//								 (json text should/must be in { } brackets)
	//			@param Event e - raw xhr event object
	//
	// @cfg int chunkSize - chunk size in bytes (default: 6MB)
	// @cfg int maxRequests - maximum request count performed at same time (default: 10)
	// @cfg string httpUsername - HTTP username (works only in Opera...)
	// @cfg string httpPassword - HTTP password (... yep, Opera...)
	// @cfg bool jsonResponse - true enables json parsing on load and analizing object (default: true)
	// @cfg string successProperty - when jsonResponse is true, checks parsedJson[successProperty] -
	//				if it is true it assumes that chunk is uploaded succesfully, otherwise chunk will
	//				be added to missing list
	// @cfg Object fieldNames - POST field names:
	//		string chunk - file field name
	//		string chunkId - chunk id field name
	//		string fileName - field's name containing original file name
	//		string totalChunks - field which holds total chunk count
	//		string isLast - field which determines is current chunk is last
	//
	function FileUpload(config)
	{
		const BYTES_PER_CHUNK = 1024 * 1024 * 6;
		const MAX_REQUESTS = 10;

		var _url = null,
			_chunkStart = 0,
			_chunkSize = BYTES_PER_CHUNK,
			_chunkEnd = BYTES_PER_CHUNK,
			_id = 0,
			_chunksLoading = 0,
			_chunksLoaded = 0,
			_file = null,
			_startedTs = 0,
			_stoppedTs = 0,
			_isLast = false,
			_maxRequests = MAX_REQUESTS,
			_totalChunks = 0,
			_fieldNames = {
				chunk: 'chunk',
				chunkId: 'chunkId',
				fileName: 'fileName',
				totalChunks: 'totalChunks',
				isLast: 'isLast',
				uploadId: 'uploadId'
			},
			_jsonResponse = true,
			_successProperty = 'success',
			_username = null,
			_password = null,
			_xhrs = [],
			_missingChunks = [],
			_uploading = false,
			_requestForCancel = false,

			self = this,

			// calbacks
			_onProgress = function() { },
			_onError = function() { },
			_onUpload = function() { },
			_onFinish = function() { },
			_onAbort = function() { },
			_onchunkProgress = function() { },
			_onchunkUpload = function() { },

			// custom but useful callbacks
			_onbeforechunkUpload = function() { },
			_onhttpError = function() { },
			_onjsonError = function() { },
			_onCancel = function() { };


		function _setConfig(config)
		{
			_url = config.url || _url,
			_chunkSize = config.chunkSize || BYTES_PER_CHUNK,
			_chunkEnd = _chunkSize,
			_file = config.file || _file,
			_maxRequests = config.maxRequests || _maxRequests,
			_totalChunks = Math.ceil(_file.size / _chunkSize);
			_username = config.httpUsername || _username;
			_password = config.httpPassword || _password;
			_jsonResponse = config.jsonResponse || _jsonResponse;
			_successProperty = config.successProperty || _successProperty;

			// set custom POST fieldnames
			if ('fieldNames' in config) {
				for (var name in config.fieldNames) {
					if (name in _fieldNames) {
						_fieldNames[name] = config.fieldNames[name];
					}
				}
			}

			// user callbacks from config object
			if ('listeners' in config) {
				var listeners = config.listeners;
				if ('progress' in listeners) {
					_onProgress = listeners.progress;
				}
				if ('chunkprogress' in listeners) {
					_onchunkProgress = listeners.chunkprogress;
				}
				if ('error' in listeners) {
					_onError = listeners.error;
				}
				if ('upload' in listeners) {
					_onUpload = listeners.upload;
				}
				if ('finish' in listeners) {
					_onFinish = listeners.finish;
				}
				if ('abort' in listeners) {
					_onAbort = listeners.abort;
				}
				if ('chunkupload' in listeners) {
					_onchunkUpload = listeners.chunkupload;
				}
				if ('beforechunkupload' in listeners) {
					_onbeforechunkUpload = listeners.beforechunkupload;
				}
				if ('cancel' in listeners) {
					_onCancel = listeners.cancel;
				}
				if ('httperror' in listeners) {
					_onhttpError = listeners.httperror;
				}
				if ('jsonerror' in listeners) {
					_onjsonError = listeners.jsonerror;
				}
			}
		};

		_setConfig(config);


		//
		// return next chunk of file
		//
		function _getChunk()
		{
			if (!_file) {
				throw new Error('File is null');
				return false;
			}

			var blob = _file;
			var chunk = null;

			if (_chunkStart < blob.size) {
				if ('mozSlice' in blob) {
					chunk = blob.mozSlice(_chunkStart, _chunkEnd);
				} else if ('webkitSlice' in blob) {
					chunk = blob.webkitSlice(_chunkStart, _chunkEnd);
				}
				else if ('slice' in blob) {
					chunk = blob.slice(_chunkStart, _chunkEnd);
				}
				else {
					throw new Error('No slice method for Blob!');
				}

				if (_chunkEnd >= blob.size) {
					_isLast = true;
				}

				_id += 1;
				_chunkStart = _chunkEnd;
				_chunkEnd += _chunkSize;

				return chunk;
			}

			return false;
		}


		//
		// remove xhr from collection
		//
		function _removeXhr(xhr)
		{
			var pos = _xhrs.indexOf(xhr);
			if (pos != -1) {
				var start = _xhrs.slice(0, pos);
				var end = _xhrs.slice(pos + 1);
				_xhrs = start.concat(end);

				return true;
			}

			return false;
		}


		//
		// upload chunk with ajax
		//
		// @param Blob chunk - chunk data
		// @param boolean isLast - true if this chunk is last for file
		//
		function _uploadChunk(chunk, chunkId, isLast)
		{
			_chunksLoading += 1;
			var fd = new FormData();
			fd.append(_fieldNames.chunk, chunk);
			fd.append(_fieldNames.fileName, _file.name);
			fd.append(_fieldNames.chunkId, chunkId);
			fd.append(_fieldNames.totalChunks, _totalChunks);
			fd.append(_fieldNames.isLast, isLast);
			fd.append(_fieldNames.uploadId, _startedTs);

			var xhr = new XMLHttpRequest();
			xhr.withCredentials = true;
			xhr.upload.addEventListener("progress", function(e) {
				if (e.lengthComputable) {
					var percentComplete = e.loaded / e.total * 100;
				}
				_onchunkProgress(chunkId, percentComplete, e);
			}, false);

			// chunk load
			xhr.addEventListener("load", function(e) {
				if (e.target.status != 200) {
					_missingChunks.push(chunkId);
					_onhttpError(self, chunkId, e.target.status, e);
				}
				else {
					var isError = false;
					if (_jsonResponse) {
						try {
							var json = JSON.parse(e.target.responseText);
							if (!json[_successProperty]) {
								_missingChunks.push(chunkId);
								_onjsonError(self, chunkId, json, e);
								isError = true;
							}
						}
						catch (err) {
							_missingChunks.push(chunkId);
							_onjsonError(self, chunkId, null, e);
							isError = true;
						}
					}

					if (!isError) {
						_chunksLoaded += 1;
						_onchunkUpload(chunkId, _chunksLoaded, e.target.responseText, e);
						_onProgress(_chunksLoaded / _totalChunks * 100, _chunksLoaded);

						// check for more chunks which were delayed
						if (!_isLast) {
							self.upload();
						}
						else if (_chunksLoaded === _totalChunks) {
							_stoppedTs = (new Date()).getTime();
							_onUpload(self, _stoppedTs - _startedTs, e);
						}
					}
				}

				_chunksLoading -= 1;
				_removeXhr(xhr);

				if (_chunksLoading <= 0) {
					_onFinish(self, _stoppedTs - _startedTs, _chunksLoaded, e);
				}
			}, false);
			xhr.addEventListener("abort", function(e) {
					_chunksLoading -= 1;
					_missingChunks.push(chunkId);
					_onAbort(e);
				}, false);
			xhr.addEventListener("error", function(e) {
					_chunksLoading -= 1;
					_removeXhr(xhr);
					_missingChunks.push(chunkId);
					_onError(e);
				}, false);

			_onbeforechunkUpload(self, chunkId, fd, xhr, isLast);

			xhr.open("POST", _url, true, _username, _password);
			xhr.send(fd);

			_xhrs.push(xhr);
		}


		//
		// PUBLIC SECTION
		//

		//
		// perform file upload
		//
		// @chainable
		//
		this.upload = function()
		{
			if (_requestForCancel) {
				return self;
			}
			// start timer
			if (!_startedTs) {
				_startedTs = (new Date()).getTime();
			}

			while (true) {
				var chunk = _getChunk();
				if (!chunk) {
					// it's last chunk!
					break;
				}
				else {
					_uploadChunk(chunk, _id, _isLast);

					if (_chunksLoading >= _maxRequests) {
						break;
					}
				}
			}

			return self;
		}


		//
		// set config values
		//
		// @chainable
		// @param Object config - config same as for constructor
		//
		this.setConfig = function(config)
		{
			_setConfig(config);
		}


		//
		// cancels uploading
		//
		// @chainable
		//
		this.cancelUpload = function()
		{
			if (!_startedTs || _xhrs.length <= 0) {
				return self;
			}

			_requestForCancel = true;
			for (var i = 0, max = _xhrs.length; i < max; i += 1) {
				if (_xhrs[i] instanceof XMLHttpRequest) {
					_xhrs[i].abort();
				}
			}

			_xhrs = [];
			_onCancel(self);

			return self;
		}


		//
		// return total chunk count
		//
		// @return int
		//
		this.getTotalChunks = function()
		{
			return _totalChunks;
		}


		//
		// return not uploaded chunks
		//
		// @return int
		//
		this.getMissingChunks = function()
		{
			return _missingChunks;
		}


		//
		// return loaded chunk count
		//
		// @return int
		//
		this.getUploadedChunks = function()
		{
			return _chunksLoaded;
		}


		//
		// returns true is at least one chunk being currently uploaded
		//
		// @return bool
		//
		this.isUploading = function()
		{
			return (_chunksLoading > 0);
		}

		return self;
	}

	// expose
	if (typeof global == 'function') {
		// jquery or other similar framework
		global[className] = function(params) {
			return new FileUpload(params).upload();
		}
	}
	else {
		// just add class to object. Class should be instantiated with new operator
		global[className] = FileUpload;
	}

})(jQuery);
