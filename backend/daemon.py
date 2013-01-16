# -*- coding: utf-8 -*-
import sys, os, os.path
import time, atexit, signal
import ConfigParser
import logging, logging.config

class Daemon:
    '''A generic daemon class.

    Usage: subclass the daemon class and override the run() method.'''

    _config = 0
    _logger = 0
    _debug = False
    _daemon = ''
    _configFile = ''

    def __init__(self, configFile = '', daemonName = 'daemon'):
        self.pidfile = ''
        self._daemon = daemonName

        if configFile != '':
            if not os.path.exists(configFile):
                print("[ERROR] - no config file found")
                sys.exit(4)

            self._config = ConfigParser.ConfigParser()
            self._config.read(configFile)

            try:
                self.pidfile = self._config.get(daemonName + '.main', 'pidfile')
            except: pass

            try:
                self._debug = self._config.getboolean(daemonName + '.debug', 'debug')
            except: pass

            logging.config.fileConfig(configFile)
            self._logger = logging.getLogger(daemonName)
            self._configFile = configFile

    def daemonize(self, pidFile = ''):
        '''Deamonize class. UNIX double fork mechanism.'''

        try:
            pid = os.fork()
            if pid > 0:
                # exit first parent
                sys.exit(0)
        except OSError as err:
            sys.stderr.write('fork #1 failed: {0}\n'.format(err))
            sys.exit(1)

        # decouple from parent environment
        #os.chdir('/')
        os.setsid()
        os.umask(0)

        # do second fork
        try:
            pid = os.fork()
            if pid > 0:

                # exit from second parent
                sys.exit(0)
        except OSError as err:
            sys.stderr.write('fork #2 failed: {0}\n'.format(err))
            sys.exit(1)

        # redirect standard file descriptors
        sys.stdout.flush()
        sys.stderr.flush()
        si = open(os.devnull, 'r')
        so = open(os.devnull, 'a+')
        se = open(os.devnull, 'a+')

        os.dup2(si.fileno(), sys.stdin.fileno())
        os.dup2(so.fileno(), sys.stdout.fileno())
        os.dup2(se.fileno(), sys.stderr.fileno())

        # write pidfile
        if pidFile != '':
            self.pidfile = pidFile
        atexit.register(self.delpid)

        pid = str(os.getpid())
        with open(self.pidfile,'w+') as f:
            f.write(pid + '\n')

    def delpid(self):
        os.remove(self.pidfile)

    def start(self):
        """Start the daemon."""

        # Check for a pidfile to see if the daemon already runs
        try:
            with open(self.pidfile,'r') as pf:

                pid = int(pf.read().strip())
        except IOError:
            pid = None

        if pid:
            message = "pidfile {0} already exist. " + \
                    "Daemon already running?\n"
            sys.stderr.write(message.format(self.pidfile))
            sys.exit(1)

        self._log('info', '-- Starting {0} .. {1}'.format(self._daemon, '-' * 10))
        self._log('info', '-- Using {0}'.format(self._configFile))

        # Start the daemon
        self.daemonize()
        self.run()

    def stop(self):
        """Stop the daemon."""

        # Get the pid from the pidfile
        try:
            with open(self.pidfile,'r') as pf:
                pid = int(pf.read().strip())
        except IOError:
            pid = None

        if not pid:
            message = "pidfile {0} does not exist. " + \
                    "Daemon not running?\n"
            sys.stderr.write(message.format(self.pidfile))
            return # not an error in a restart

        self._log('info', '-- Stopping {0}..'.format(self._daemon))

        # Try killing the daemon process
        try:
            while 1:
                os.kill(pid, signal.SIGTERM)
                time.sleep(0.1)
        except OSError as err:
            e = str(err.args)
            if e.find("No such process") > 0:
                if os.path.exists(self.pidfile):
                    os.remove(self.pidfile)
            else:
                print (str(err.args))
                sys.exit(1)

    def restart(self):
        """Restart the daemon."""
        self.stop()
        self.start()

    def run(self):
        """You should override this method when you subclass Daemon.

        It will be called after the process has been daemonized by
        start() or restart()."""

    def _log(self, level, text):
        if self._debug:
            getattr(self._logger, level)(text)
            #eval('self._logger.'+level+"('" + text + "')")

