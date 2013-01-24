#!/usr/bin/python2.7
# -*- coding: utf-8 -*-

import SimpleHTTPServer
import SocketServer
import re, cgi, json
import os, os.path, sys
import subprocess
import threading

from glob import glob
from daemon import Daemon

#
# Custom HTTP request handler for httpd
#
class MyHandler(SimpleHTTPServer.SimpleHTTPRequestHandler):
    server_version= "CustomHandler/1.1"

    #
    # handle OPTIONS header used for cross domain requests
    #
    def do_OPTIONS(self):
        self.send_response(200, "OK")
        if 'Origin' in self.headers:
            self.send_header('Access-Control-Allow-Origin', self.headers['Origin'])
        self.send_header('Access-Control-Allow-Credentials', "true")
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header("Access-Control-Allow-Headers", "X-Requested-With, Content-Type")

    #
    # Handle GET requests
    #
    def do_GET(self):
        SimpleHTTPServer.SimpleHTTPRequestHandler.do_GET(self)


    #
    # Handle POST request
    #
    def do_POST(self):
        print "POST REQUEST: ", self.path

        self.send_response(200)
        if 'Origin' in self.headers:
            self.send_header('Access-Control-Allow-Origin', self.headers['Origin'])
            self.send_header('Access-Control-Allow-Credentials', "true")
        self.send_header("Content-Type", "application/json")

        # Parse the form data posted
        form = cgi.FieldStorage(
            fp = self.rfile,
            headers = self.headers,
            environ = {
                'REQUEST_METHOD':'POST',
                'CONTENT_TYPE':self.headers['Content-Type'],
            }
        )

        print "===== <POST DATA> ====="
        print "Headers: \n", self.headers
        print "Form fields: "
        for k in form.keys():
            if not form[k].filename:
                print " {0}: {1}".format(k, form[k].value)
            else:
                print " {0}: filename '{1}', type: {1}".format(k, form[k].filename, form[k].type)
        print "===== <POST DATA> =====\n"

        self.end_headers()
        self.processUpload(form)

        #self.wfile.write(output)


    #
    #
    #
    def processUpload(self, form):
        '''
        fields:
            totalChunks
            chunk - (file field)
            chunkId
            isLast
            fileName
        '''
               
        if form['chunk'].filename:
            chunkPrefix = 'chunk'
            fileName = form['fileName'].value
            fileObj = form['chunk'].file
            # temp upload dir for file
            uploadDir = self.uploadDir + '/dir_' + fileName
            if not os.path.exists(uploadDir): 
                os.mkdir(uploadDir)

            fw = open('{0}/{1}{2}'.format(uploadDir, chunkPrefix, form['chunkId'].value), 'wb')
            content = fileObj.read()
            while content:
                fw.write(content)
                content = fileObj.read()
                    
            fw.close()
            
            uploaded = len(glob(uploadDir + '/*'))
            if uploaded == int(form['totalChunks'].value):
                self.wfile.write(json.dumps({'success': True, 'status': 'Cating chunks'}))
                
                # timer thread for cating files, avoiding blocking response to client
                (threading.Timer(0, self.catChunks, 
                                 kwargs = {'fileName': fileName, 'uploadDir': uploadDir, 'chunkPrefix': chunkPrefix, 'chunkCount': uploaded})).start()
                return True
            else:
                self.wfile.write(json.dumps({'success': True, 'status': 'Uploaded'}))
                return True
                
        self.wfile.write(json.dumps({'success': False, 'status': 'No file'}))
        return False
        
    
    #
    # cat chunks
    #
    # @param string uploadDir - directory, containing chunks
    # @param string chunkPrefix - prefix for chunk file name
    # @param int chunkCount - total chunk count
    # @param string fileName - original file name
    #
    def catChunks(self, uploadDir, chunkPrefix, chunkCount, fileName):
        chunks = []
        destFile = os.path.join(self.uploadDir, fileName)
               
        it = 0
        body, ext = os.path.splitext(destFile)        
        while os.path.exists(destFile):
            # destination file already exists, get new name
            # get next number for same base filename
            count = len(glob(body + '*' + ext))
            
            destFile = "{0}({1}){2}".format(body, count + it, ext)
            it += 1
        
        for i in xrange(1, chunkCount + 1):
            chunks.append('"' + uploadDir + '/' + chunkPrefix + str(i) + '"')
        
        # concat all chunks
        command = 'cat ' + ' '.join(chunks) + ' > "' + destFile + '"'
        subprocess.call(command, shell=True)
        
        # remove temp directory
        subprocess.call(['rm', '-r', uploadDir])
                
                
                

#
# Subclass of base TCP Server just to allow reuse same port after
# crash, unhandled exceptions etc.
#
class MySocketServer(SocketServer.TCPServer):
    allow_reuse_address = True


#
# Http Daemon class
#
class HttpDaemon(Daemon):
    def run(self):
        configSection = 'http.main'
        Handler = MyHandler
        Handler.uploadDir = self._config.get(configSection, 'uploadDir')
        Handler.documentRoot = self._config.get(configSection, 'documentRoot')

        # go to html content directory
        if Handler.documentRoot:
            os.chdir(Handler.documentRoot)
        
        port = self._config.getint(configSection, 'port')
        print "Serving on:", port
        httpd = MySocketServer(("", port), Handler)

        try:
            httpd.serve_forever()
        except Exception as err:
            httpd.shutdown()


#
# etry point
#
if __name__ == "__main__":
    configFile = 'daemon.conf'
    noDaemon = False
    stopDaemon = False
    restartDaemon = False

    if len(sys.argv) >= 3:
        # nurodytas konfigas
        if sys.argv[1] == '-c':
            configFile = sys.argv[2]
    elif len(sys.argv) >= 2:
        if sys.argv[1] == '-h':
            print "Usage: ./{0} [-c path_to_custom_config]"
            sys.exit(0)
        elif sys.argv[1] == '-d':
            noDaemon = True
        elif sys.argv[1] == 'stop':
            stopDaemon = True
        elif sys.argv[1] == 'restart':
            restartDaemon = True
        else:
            print("Unknown option")
            sys.exit(2)

    d = HttpDaemon(configFile, 'http')

    if restartDaemon:
        d.restart()
    elif stopDaemon:
        d.stop()
    else:
        if noDaemon:
            d.run()
        else:
            d.start()

