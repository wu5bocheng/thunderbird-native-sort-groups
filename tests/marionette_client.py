import json,socket
class Client:
 def __init__(self, port=2828):
  self.sock=socket.create_connection(('127.0.0.1',port),timeout=10);self.n=0;self.receive();self.send('WebDriver:NewSession',{'capabilities':{}});self.send('Marionette:SetContext',{'value':'chrome'})
 def receive(self):
  size=b''
  while True:
   b=self.sock.recv(1)
   if b==b':':break
   if not b:raise EOFError()
   size+=b
  data=b''
  while len(data)<int(size):data+=self.sock.recv(int(size)-len(data))
  return json.loads(data)
 def send(self,method,params):
  self.n+=1;p=json.dumps([0,self.n,method,params]).encode();self.sock.sendall(str(len(p)).encode()+b':'+p);r=self.receive()
  if r[2]:raise RuntimeError(r[2])
  return r[3]
 def js(self,script,args=[]):return self.send('WebDriver:ExecuteScript',{'script':script,'args':args,'newSandbox':True,'sandbox':'default'})
