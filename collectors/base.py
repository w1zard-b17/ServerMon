# base.py - contract every collector conforms to

from abc import ABC, abstractmethod
from typing import Dict, Any


class Collector(ABC):
    '''
    every collector subclasses this and implements run()
    host_manager.py only ever calls .safe_run()
    '''
    name: str

    @abstractmethod
    def run(self, ssh_client) -> Dict[str, Any]:
        ...

    def safe_run(self, ssh_client) -> Dict[str, Any]:
        try:
            data = self.run(ssh_client)
            return {"status": "ok", "data": data, "message": None}
        except Exception as e:
            return {"status": "error", "data": None, "message": str(e)}